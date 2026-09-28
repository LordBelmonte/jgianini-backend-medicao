'use strict';
const { Prisma } = require('@prisma/client');
const prisma      = require('../../config/prisma');
const repository  = require('./measurements.repository');
const validation  = require('./measurements.validation');
const alService   = require('../als/als.service');
const notifSvc    = require('../notifications/notifications.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE MEDIÇÕES — regras de negócio
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId || null, action, entity_type: 'measurement', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function err(msg, code, status = 400, details) {
  const e = new Error(msg); e.statusCode = status; e.code = code; if (details) e.details = details; return e;
}

// ─── autorização contextual ───────────────────────────────────────────────

async function assertMeasurementAccess(measurement, actor) {
  const isAdminOrDirector = actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR');
  if (isAdminOrDirector) return;

  if (actor.roles.includes('CONTRACTOR')) {
    if (measurement.contractor_id !== actor.contractor_id) throw err('Acesso negado.', 'FORBIDDEN', 403);
    return;
  }
  const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: measurement.work_id } });
  if (!link) throw err('Usuário não está vinculado a esta obra.', 'FORBIDDEN', 403);
}

async function assertWorkAccess(workId, actor) {
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) return;
  if (actor.roles.includes('CONTRACTOR')) {
    const link = await prisma.work_contractors.findFirst({ where: { work_id: workId, contractor_id: actor.contractor_id, active: true } });
    if (!link) throw err('Empreiteiro não vinculado a esta obra.', 'FORBIDDEN', 403);
    return;
  }
  const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: workId } });
  if (!link) throw err('Usuário não vinculado a esta obra.', 'FORBIDDEN', 403);
}

async function getMeasurement(id) {
  const m = await repository.findById(id);
  if (!m) throw err('Medição não encontrada.', 'MEASUREMENT_NOT_FOUND', 404);
  return m;
}

// ─── cálculo de área e valor ───────────────────────────────────────────────

/**
 * Calcula area_m2 e total_value para um item.
 * unit_price é congelado no momento passado (histórico).
 */
function calcItem(unit, widthMm, heightMm, quantity, unitPrice) {
  const qty = new Prisma.Decimal(quantity);
  const up  = new Prisma.Decimal(unitPrice);

  if (unit === 'M2') {
    const area = new Prisma.Decimal(widthMm).mul(heightMm).div(1_000_000);
    // total = qty * area * unitPrice
    const total = qty.mul(area).mul(up);
    return { area_m2: area, total_value: total };
  }
  // UN e DIA: total = qty * unitPrice
  return { area_m2: null, total_value: qty.mul(up) };
}

/**
 * Recalcula measurement_financials a partir dos itens e retrabalhos da medição.
 * gross = Σ total_value dos items + Σ total_value dos retrabalhos
 * retention_amount = gross * retention_percent / 100
 * net = gross - retention - advance - discount  (>= 0)
 * remaining = net - paid
 */
async function recalcFinancial(measurementId, retentionPercent, advanceAmount, discountAmount) {
  // Somar itens
  const itemsAgg = await prisma.measurement_items.aggregate({
    where: { measurement_id: measurementId },
    _sum:  { total_value: true },
  });
  // Somar retrabalhos
  const reworksAgg = await prisma.reworks.aggregate({
    where: { measurement_id: measurementId },
    _sum:  { total_value: true },
  });

  const gross = (itemsAgg._sum.total_value ?? new Prisma.Decimal(0))
    .add(reworksAgg._sum.total_value ?? new Prisma.Decimal(0));

  const pct   = new Prisma.Decimal(retentionPercent);
  const adv   = new Prisma.Decimal(advanceAmount || 0);
  const disc  = new Prisma.Decimal(discountAmount || 0);

  const retAmt = gross.mul(pct).div(100);
  let   net    = gross.sub(retAmt).sub(adv).sub(disc);
  if (net.lt(0)) net = new Prisma.Decimal(0);

  const existing = await repository.getFinancial(measurementId);
  const paid     = existing ? new Prisma.Decimal(existing.paid_amount) : new Prisma.Decimal(0);
  let   remaining = net.sub(paid);
  if (remaining.lt(0)) remaining = new Prisma.Decimal(0);

  let financialStatus = 'PENDING';
  if (paid.gt(0) && remaining.gt(0)) financialStatus = 'PARTIAL';
  else if (paid.gt(0) && remaining.lte(0)) financialStatus = 'PAID';

  return repository.upsertFinancial(measurementId, {
    gross_amount:      gross,
    retention_percent: pct,
    retention_amount:  retAmt,
    advance_amount:    adv,
    discount_amount:   disc,
    net_amount:        net,
    paid_amount:       paid,
    remaining_amount:  remaining,
    financial_status:  financialStatus,
  });
}

/**
 * Busca retenção do contrato. Se for medição excepcional sem contrato, usa 0.
 */
async function getRetentionPercent(contractId, exceptionalRetention) {
  if (contractId) {
    const c = await prisma.contracts.findUnique({ where: { id: contractId }, select: { retention_percent: true } });
    return c ? c.retention_percent : new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(exceptionalRetention || 0);
}

/**
 * Gera número oficial da medição.
 * Formato: NNN-SVCCODE-WORKCODE-CONTRCODE-MM/YYYY
 * MM/YYYY = competence_month da medição (Doc1 §11 — "mês e ano de competência")
 * NNN = sequência por obra (reiniciada por obra — Doc1 §11)
 */
async function generateNumber(measurement) {
  const seq     = await repository.nextSequenceForWork(measurement.work_id);
  const seqStr  = String(seq).padStart(3, '0');

  // Código do serviço: primeiro item ou 'EXC' para excepcional
  let svcCode = 'EXC';
  if (measurement.measurement_items && measurement.measurement_items.length > 0) {
    svcCode = (measurement.measurement_items[0].service?.code || 'SVC').substring(0, 8);
  }

  const workCode  = (measurement.work?.code  || measurement.work_id.substring(0, 6)).substring(0, 10);
  const contrName = measurement.contractor?.name || '';
  const contrCode = contrName.replace(/\s/g, '').substring(0, 6).toUpperCase() || measurement.contractor_id.substring(0, 6);

  // MM/YYYY vem do competence_month (formato YYYY-MM)
  const [year, month] = (measurement.competence_month || '').split('-');
  const monthYear = (month && year) ? `${month}/${year}` : `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;

  return `${seqStr}-${svcCode}-${workCode}-${contrCode}-${monthYear}`;
}

// ─── status history ────────────────────────────────────────────────────────

async function recordHistory(measurementId, prevStatus, newStatus, action, actorId, reason, observation) {
  return repository.addStatusHistory({
    measurement_id:  measurementId,
    previous_status: prevStatus,
    new_status:      newStatus,
    action,
    user_id:         actorId,
    reason:          reason   || null,
    observation:     observation || null,
  });
}

// ─── operações públicas ────────────────────────────────────────────────────

async function list(params, actor) {
  let { workId, contractorId, contractId, status, isExceptional, competenceMonth, page, limit } = params;

  // Filtro contextual
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('DIRECTOR')) {
    if (actor.roles.includes('CONTRACTOR')) {
      contractorId = actor.contractor_id;
    } else {
      // Fiscal/Coord/Responsible — filtrar por obras vinculadas
      if (!workId) {
        const links = await prisma.user_works.findMany({ where: { user_id: actor.id }, select: { work_id: true } });
        if (links.length === 0) return { items: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } };
        // Se não filtrou por obra específica, repassar sem workId — o list já filtra
      }
    }
  }

  return repository.list({ workId, contractorId, contractId, status, isExceptional, competenceMonth, page, limit, actor });
}

async function findById(id, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);
  return m;
}

async function create(data, actor) {
  const errors = validation.validateCreate(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  // Verificar obra
  const work = await prisma.works.findUnique({ where: { id: data.work_id } });
  if (!work) throw err('Obra não encontrada.', 'WORK_NOT_FOUND', 404);
  await assertWorkAccess(data.work_id, actor);

  // Verificar empreiteiro
  const contractor = await prisma.contractors.findUnique({ where: { id: data.contractor_id } });
  if (!contractor) throw err('Empreiteiro não encontrado.', 'CONTRACTOR_NOT_FOUND', 404);

  // Medição excepcional: somente Coordinator (e Admin)
  if (data.is_exceptional) {
    if (!actor.roles.includes('COORDINATOR') && !actor.roles.includes('ADMIN')) {
      throw err('Somente Coordenador pode criar medição excepcional.', 'FORBIDDEN', 403);
    }
  }

  // Verificar contrato se informado
  if (data.contract_id) {
    const contract = await prisma.contracts.findUnique({ where: { id: data.contract_id } });
    if (!contract) throw err('Contrato não encontrado.', 'CONTRACT_NOT_FOUND', 404);
  }

  const measurement = await repository.create({
    work_id:            data.work_id,
    contractor_id:      data.contractor_id,
    contract_id:        data.contract_id    || null,
    status:             data.is_exceptional ? 'DRAFT_EXCEPTIONAL' : 'DRAFT',
    is_exceptional:     data.is_exceptional || false,
    exceptional_reason: data.exceptional_reason || null,
    competence_month:   data.competence_month,
    created_by:         actor.id,
  });

  await audit({ actorId: actor.id, action: 'CREATE_MEASUREMENT', entityId: measurement.id, newValues: { status: measurement.status, is_exceptional: measurement.is_exceptional } });
  return measurement;
}

async function update(id, data, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);

  const editableStatuses = ['DRAFT', 'RETURNED_TO_CONTRACTOR', 'DRAFT_EXCEPTIONAL'];
  if (!editableStatuses.includes(m.status)) throw err(`Medição não editável no status ${m.status}.`, 'MEASUREMENT_NOT_EDITABLE', 403);

  const allowed = {};
  if (data.competence_month) allowed.competence_month = data.competence_month;
  if (data.exceptional_reason !== undefined) allowed.exceptional_reason = data.exceptional_reason;

  const updated = await repository.update(id, allowed);
  await audit({ actorId: actor.id, action: 'UPDATE_MEASUREMENT', entityId: id, newValues: allowed });
  return updated;
}

// ─── itens ──────────────────────────────────────────────────────────────────

async function addItem(measurementId, data, actor) {
  const m = await getMeasurement(measurementId);
  await assertMeasurementAccess(m, actor);

  const editableStatuses = ['DRAFT', 'RETURNED_TO_CONTRACTOR', 'DRAFT_EXCEPTIONAL'];
  if (!editableStatuses.includes(m.status)) throw err(`Medição não editável no status ${m.status}.`, 'MEASUREMENT_NOT_EDITABLE', 403);

  // Verificar serviço — validação de entrada primeiro
  // Verificar serviço — service_id obrigatório antes de qualquer query
  if (!data.service_id || typeof data.service_id !== 'string') {
    throw err('service_id é obrigatório.', 'VALIDATION_ERROR', 400, [{ field: 'service_id', message: 'Serviço é obrigatório.' }]);
  }

  const svc = await prisma.services.findUnique({ where: { id: data.service_id } });
  if (!svc || !svc.active) throw err('Serviço não encontrado ou inativo.', 'SERVICE_NOT_FOUND', 404);

  const itemErrors = validation.validateItem(data, svc.unit);
  if (itemErrors.length > 0) throw err('Dados do item inválidos.', 'VALIDATION_ERROR', 400, itemErrors);

  // Se serviço exige AL
  if (svc.requires_al && !data.al_id) throw err('Serviço exige AL.', 'AL_REQUIRED', 400);
  if (data.al_id) {
    const al = await prisma.als.findUnique({ where: { id: data.al_id } });
    if (!al || al.status !== 'APPROVED') throw err('AL não encontrada ou não aprovada.', 'AL_NOT_APPROVED', 409);
    if (al.work_id !== m.work_id) throw err('AL não pertence à obra da medição.', 'AL_WORK_MISMATCH', 400);
  }

  // unit_price: vem do parâmetro (será congelado); se não informado, buscar do contrato
  let unitPrice = data.unit_price;
  if (!unitPrice && m.contract_id) {
    const cs = await prisma.contract_services.findFirst({
      where: { contract_id: m.contract_id, service_id: data.service_id, active: true },
    });
    if (cs) unitPrice = cs.unit_price;
  }
  if (!unitPrice) throw err('Preço unitário é obrigatório.', 'UNIT_PRICE_REQUIRED', 400);

  const { area_m2, total_value } = calcItem(svc.unit, data.width_mm, data.height_mm, data.quantity, unitPrice);

  const item = await repository.addItem({
    measurement_id: measurementId,
    service_id:     data.service_id,
    al_id:          data.al_id || null,
    description:    data.description || null,
    width_mm:       svc.unit === 'M2' ? parseInt(data.width_mm, 10) : null,
    height_mm:      svc.unit === 'M2' ? parseInt(data.height_mm, 10) : null,
    area_m2:        area_m2,
    quantity:       data.quantity,
    unit_price:     unitPrice,
    total_value:    total_value,
  });

  // Recalcular financeiro
  const retPct = await getRetentionPercent(m.contract_id, null);
  await recalcFinancial(measurementId, retPct, 0, 0);

  return item;
}

async function removeItem(measurementId, itemId, actor) {
  const m = await getMeasurement(measurementId);
  await assertMeasurementAccess(m, actor);

  const editableStatuses = ['DRAFT', 'RETURNED_TO_CONTRACTOR', 'DRAFT_EXCEPTIONAL'];
  if (!editableStatuses.includes(m.status)) throw err('Medição não editável.', 'MEASUREMENT_NOT_EDITABLE', 403);

  const item = await repository.findItemById(itemId);
  if (!item || item.measurement.id !== measurementId) throw err('Item não encontrado.', 'ITEM_NOT_FOUND', 404);

  // Remover produções vinculadas ao item antes de deletar
  await prisma.productions.deleteMany({ where: { measurement_item_id: itemId } });
  await repository.deleteItem(itemId);

  const retPct = await getRetentionPercent(m.contract_id, null);
  await recalcFinancial(measurementId, retPct, 0, 0);
  return { message: 'Item removido.' };
}

// ─── envio (DRAFT → FISCAL_REVIEW ou DRAFT_EXCEPTIONAL → COORDINATOR_REVIEW) ─

async function submit(id, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);

  let expectedStatus, nextStatus;
  if (m.is_exceptional) {
    expectedStatus = 'DRAFT_EXCEPTIONAL';
    nextStatus     = 'COORDINATOR_REVIEW';
  } else {
    expectedStatus = 'DRAFT';
    nextStatus     = 'FISCAL_REVIEW';
  }

  if (m.status !== expectedStatus) throw err(`Transição inválida: ${m.status} → ${nextStatus}.`, 'INVALID_STATUS_TRANSITION', 400);

  // Verificar se há itens
  if (!m.measurement_items || m.measurement_items.length === 0) throw err('Medição deve ter ao menos um item antes do envio.', 'NO_ITEMS', 400);

  // Calcular/atualizar financeiro antes de enviar
  const retPct = await getRetentionPercent(m.contract_id, null);
  await recalcFinancial(id, retPct, 0, 0);

  await repository.update(id, { status: nextStatus, submitted_at: new Date() });
  await recordHistory(id, m.status, nextStatus, 'SUBMIT', actor.id, null, null);
  await audit({ actorId: actor.id, action: 'SUBMIT_MEASUREMENT', entityId: id, oldValues: { status: m.status }, newValues: { status: nextStatus } });

  // Notificar (não bloqueante)
  const updated = await repository.findById(id);
  notifSvc.onMeasurementSubmitted(updated).catch(() => {});

  return updated;
}

// ─── cancelamento ───────────────────────────────────────────────────────────

async function cancel(id, data, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);

  // Apenas Responsible, Coordinator, Director podem cancelar (Doc4 §33)
  const canCancel = ['RESPONSIBLE', 'COORDINATOR', 'DIRECTOR', 'ADMIN'];
  if (!actor.roles.some(r => canCancel.includes(r))) {
    throw err('Perfil não autorizado a cancelar medições.', 'FORBIDDEN', 403);
  }

  if (m.status === 'CANCELLED') throw err('Medição já cancelada.', 'STATUS_UNCHANGED', 409);

  const errors = validation.validateCancel(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  const old = m.status;
  await repository.update(id, { status: 'CANCELLED', cancelled_at: new Date(), cancellation_reason: data.reason, cancelled_by: actor.id });
  await recordHistory(id, old, 'CANCELLED', 'CANCEL', actor.id, data.reason, null);
  await audit({ actorId: actor.id, action: 'CANCEL_MEASUREMENT', entityId: id, oldValues: { status: old }, newValues: { status: 'CANCELLED', reason: data.reason } });

  return repository.findById(id);
}

// ─── devolução pelo Fiscal → Empreiteiro ────────────────────────────────────

async function returnToContractor(id, data, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);

  if (m.status !== 'FISCAL_REVIEW') throw err(`Transição inválida: ${m.status} → RETURNED_TO_CONTRACTOR.`, 'INVALID_STATUS_TRANSITION', 400);

  const errors = validation.validateReturn(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  await repository.update(id, { status: 'RETURNED_TO_CONTRACTOR' });
  await recordHistory(id, m.status, 'RETURNED_TO_CONTRACTOR', 'RETURN', actor.id, data.reason, data.observation || null);
  await audit({ actorId: actor.id, action: 'RETURN_MEASUREMENT', entityId: id, oldValues: { status: m.status }, newValues: { status: 'RETURNED_TO_CONTRACTOR', reason: data.reason } });

  return repository.findById(id);
}

// ─── reenvio (RETURNED_TO_CONTRACTOR → FISCAL_REVIEW) ──────────────────────

async function resubmit(id, actor) {
  const m = await getMeasurement(id);
  await assertMeasurementAccess(m, actor);

  if (m.status !== 'RETURNED_TO_CONTRACTOR') throw err(`Transição inválida: ${m.status} → FISCAL_REVIEW.`, 'INVALID_STATUS_TRANSITION', 400);

  await repository.update(id, { status: 'FISCAL_REVIEW', submitted_at: new Date() });
  await recordHistory(id, m.status, 'FISCAL_REVIEW', 'RESUBMIT', actor.id, null, null);
  await audit({ actorId: actor.id, action: 'RESUBMIT_MEASUREMENT', entityId: id, oldValues: { status: m.status }, newValues: { status: 'FISCAL_REVIEW' } });

  return repository.findById(id);
}

module.exports = {
  list, findById, create, update,
  addItem, removeItem,
  submit, cancel, returnToContractor, resubmit,
  getMeasurement, assertMeasurementAccess,
  recalcFinancial, getRetentionPercent, generateNumber,
  recordHistory,
};
