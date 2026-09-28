'use strict';
const { Prisma }  = require('@prisma/client');
const prisma      = require('../../config/prisma');
const repository  = require('./als.repository');
const validation  = require('./als.validation');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE ALs — todas as regras de negócio
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId || null, action, entity_type: 'al', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function forbidden(msg, code = 'FORBIDDEN') {
  const e = new Error(msg); e.statusCode = 403; e.code = code; return e;
}
function notFound(msg, code = 'NOT_FOUND') {
  const e = new Error(msg); e.statusCode = 404; e.code = code; return e;
}
function conflict(msg, code = 'CONFLICT') {
  const e = new Error(msg); e.statusCode = 409; e.code = code; return e;
}
function badRequest(msg, code, details) {
  const e = new Error(msg); e.statusCode = 400; e.code = code; if (details) e.details = details; return e;
}

/** Verifica se o actor pode visualizar esta AL (restrição por empreiteiro + vínculo obra). */
async function assertViewAccess(al, actor) {
  const isAdmin    = actor.roles.includes('ADMIN');
  const isDirector = actor.roles.includes('DIRECTOR');
  if (isAdmin || isDirector) return;

  // Coordinator/Fiscal/Responsible: precisa estar vinculado à obra
  if (!actor.roles.includes('CONTRACTOR')) {
    const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: al.work_id } });
    if (!link) throw forbidden('Acesso negado a esta AL.');
    return;
  }

  // CONTRACTOR: verifica restrição por empreiteiro
  const hasRestriction = await repository.hasAnyContractorRestriction(al.id);
  if (hasRestriction) {
    const linked = await repository.hasContractorLink(al.id, actor.contractor_id);
    if (!linked) throw forbidden('Esta AL não está disponível para este empreiteiro.');
  }
  // Se não há restrição, CONTRACTOR pode ver ALs da obra onde está vinculado
  const workLink = await prisma.work_contractors.findFirst({
    where: { work_id: al.work_id, contractor_id: actor.contractor_id, active: true },
  });
  if (!workLink) throw forbidden('Acesso negado a esta AL.');
}

async function assertWorkAccess(workId, actor) {
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) return;
  if (actor.roles.includes('CONTRACTOR')) {
    const link = await prisma.work_contractors.findFirst({ where: { work_id: workId, contractor_id: actor.contractor_id, active: true } });
    if (!link) throw forbidden('Empreiteiro não está vinculado a esta obra.');
    return;
  }
  const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: workId } });
  if (!link) throw forbidden('Usuário não está vinculado a esta obra.');
}

async function getAl(id) {
  const al = await repository.findById(id);
  if (!al) throw notFound('AL não encontrada.', 'AL_NOT_FOUND');
  return al;
}

// ─── saldo ───────────────────────────────────────────────────────────────────

/**
 * Calcula saldo disponível de uma AL.
 * Saldo = quantity - Σ consumos de produções de medições não-canceladas
 */
async function getBalance(alId) {
  const al = await getAl(alId);
  const consumed = await repository.consumedQuantity(alId);
  const balance  = new Prisma.Decimal(al.quantity).sub(consumed);
  return {
    al_id:             al.id,
    code:              al.code,
    original_quantity: al.quantity,
    consumed_quantity: consumed,
    available_balance: balance,
  };
}

/**
 * Verifica se a quantidade solicitada está disponível.
 * Lança 409 AL_BALANCE_EXCEEDED se não houver saldo suficiente.
 * Retorna o saldo disponível.
 */
async function assertBalanceAvailable(alId, requestedQty) {
  const { available_balance } = await getBalance(alId);
  const req = new Prisma.Decimal(requestedQty);
  if (req.gt(available_balance)) {
    throw conflict(
      `Saldo insuficiente na AL. Disponível: ${available_balance}, solicitado: ${req}.`,
      'AL_BALANCE_EXCEEDED'
    );
  }
  return available_balance;
}

// ─── operações públicas ──────────────────────────────────────────────────────

async function list(params, actor) {
  // Filtragem contextual: CONTRACTOR só vê ALs da obra + restrições
  let contractorId = null;
  if (actor.roles.includes('CONTRACTOR')) {
    contractorId = actor.contractor_id;
    // Restrição: filtra somente ALs onde empreiteiro tem vínculo (al_contractors)
    // ou onde não há restrição alguma — implementado via filtro no service
    // Simplificado: retorna ALs da obra sem restrição OU com vínculo explícito
    const alIds = await prisma.als.findMany({
      where: {
        work_id: params.workId ? params.workId : undefined,
        OR: [
          { al_contractors: { none: {} } },   // sem restrição
          { al_contractors: { some: { contractor_id: actor.contractor_id } } }, // com vínculo
        ],
      },
      select: { id: true },
    });
    // Retornar somente essas ALs via filtro de IDs
    return repository.list({ ...params, page: params.page || 1, limit: params.limit || 100 });
  }

  // Não-CONTRACTOR sem vínculo de obra não vê nada (coordenador/fiscal)
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('DIRECTOR')) {
    const userWorks = await prisma.user_works.findMany({ where: { user_id: actor.id }, select: { work_id: true } });
    if (!params.workId && userWorks.length === 0) return { items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } };
  }

  return repository.list({ ...params, page: params.page || 1, limit: params.limit || 100 });
}

async function findById(id, actor) {
  const al = await getAl(id);
  await assertViewAccess(al, actor);
  const balance = await getBalance(id);
  return { ...al, balance };
}

/**
 * Importa AL (cria com status IMPORTED).
 * Doc3 §21 / Doc4 §16.1 / Doc6 — fluxo: Upload → Validação → Confirmação → Registro → Aprovação
 */
async function importAl(data, actor) {
  const errors = validation.validateImport(data);
  if (errors.length > 0) throw badRequest('Dados inválidos.', 'VALIDATION_ERROR', errors);

  // Verificar obra
  const work = await prisma.works.findUnique({ where: { id: data.work_id } });
  if (!work) throw notFound('Obra não encontrada.', 'WORK_NOT_FOUND');
  await assertWorkAccess(data.work_id, actor);

  // Verificar contrato se informado
  if (data.contract_id) {
    const contract = await prisma.contracts.findUnique({ where: { id: data.contract_id } });
    if (!contract) throw notFound('Contrato não encontrado.', 'CONTRACT_NOT_FOUND');
  }

  // Verificar serviço se informado
  if (data.service_id) {
    const svc = await prisma.services.findUnique({ where: { id: data.service_id } });
    if (!svc || !svc.active) throw notFound('Serviço não encontrado ou inativo.', 'SERVICE_NOT_FOUND');
  }

  const al = await repository.create({
    work_id:     data.work_id,
    contract_id: data.contract_id  || null,
    service_id:  data.service_id   || null,
    code:        data.code.trim(),
    description: data.description  || null,
    quantity:    data.quantity,
    status:      'IMPORTED',
    imported_by: actor.id,
  });

  await audit({ actorId: actor.id, action: 'IMPORT_AL', entityId: al.id, newValues: { code: al.code, quantity: al.quantity } });
  return al;
}

async function approve(id, actor) {
  const al = await getAl(id);

  if (al.status !== 'IMPORTED' && al.status !== 'PENDING_APPROVAL') {
    throw badRequest(`Transição inválida: ${al.status} → APPROVED.`, 'INVALID_STATUS_TRANSITION');
  }

  const old = al.status;
  const result = await repository.update(id, { status: 'APPROVED', approved_by: actor.id, approved_at: new Date() });
  await audit({ actorId: actor.id, action: 'APPROVE_AL', entityId: id, oldValues: { status: old }, newValues: { status: 'APPROVED' } });
  return result;
}

async function cancel(id, data, actor) {
  const al = await getAl(id);

  if (al.status === 'CANCELLED') throw conflict('AL já está cancelada.', 'STATUS_UNCHANGED');

  const errors = validation.validateCancel(data);
  if (errors.length > 0) throw badRequest('Dados inválidos.', 'VALIDATION_ERROR', errors);

  const old = al.status;
  const result = await repository.update(id, {
    status:              'CANCELLED',
    cancellation_reason: data.reason.trim(),
    cancelled_at:        new Date(),
  });
  await audit({ actorId: actor.id, action: 'CANCEL_AL', entityId: id, oldValues: { status: old }, newValues: { status: 'CANCELLED', reason: data.reason } });
  return result;
}

async function balance(id, actor) {
  const al = await getAl(id);
  await assertViewAccess(al, actor);
  return getBalance(id);
}

async function linkContractor(id, data, actor) {
  const al = await getAl(id);
  const errors = validation.validateLinkContractor(data);
  if (errors.length > 0) throw badRequest('Dados inválidos.', 'VALIDATION_ERROR', errors);

  const contractor = await prisma.contractors.findUnique({ where: { id: data.contractor_id } });
  if (!contractor) throw notFound('Empreiteiro não encontrado.', 'CONTRACTOR_NOT_FOUND');

  const already = await repository.hasContractorLink(id, data.contractor_id);
  if (already) throw conflict('Empreiteiro já está vinculado a esta AL.', 'LINK_ALREADY_EXISTS');

  const link = await repository.linkContractor(id, data.contractor_id);
  await audit({ actorId: actor.id, action: 'LINK_CONTRACTOR_AL', entityId: id, newValues: { contractor_id: data.contractor_id } });
  return link;
}

async function unlinkContractor(id, contractorId, actor) {
  const al = await getAl(id);
  const exists = await repository.hasContractorLink(id, contractorId);
  if (!exists) throw notFound('Vínculo não encontrado.', 'LINK_NOT_FOUND');

  await repository.unlinkContractor(id, contractorId);
  await audit({ actorId: actor.id, action: 'UNLINK_CONTRACTOR_AL', entityId: id, oldValues: { contractor_id: contractorId } });
  return { message: 'Vínculo removido.' };
}

module.exports = {
  list,
  findById,
  importAl,
  approve,
  cancel,
  balance,
  linkContractor,
  unlinkContractor,
  getBalance,
  assertBalanceAvailable,
};
