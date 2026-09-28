'use strict';
const prisma      = require('../../config/prisma');
const repository  = require('./additives.repository');
const validation  = require('./additives.validation');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE ADITIVOS
// Todas as regras de negócio ficam aqui.
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id:     actorId || null,
      action,
      entity_type: 'additive',
      entity_id:   entityId,
      old_values:  oldValues  || null,
      new_values:  newValues  || null,
    },
  });
}

/** Verifica se o actor tem acesso ao contrato (via obra ou é contractor dono). */
async function assertContractAccess(contract, actor) {
  const isAdminOrDirector = actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR');
  if (isAdminOrDirector) return;

  if (actor.roles.includes('CONTRACTOR')) {
    if (contract.contractor_id !== actor.contractor_id) {
      const err = new Error('Acesso negado a este contrato.'); err.statusCode = 403; err.code = 'FORBIDDEN'; throw err;
    }
    return;
  }

  const link = await prisma.user_works.findFirst({
    where: { user_id: actor.id, work_id: contract.work_id },
  });
  if (!link) {
    const err = new Error('Acesso negado a este contrato.'); err.statusCode = 403; err.code = 'FORBIDDEN'; throw err;
  }
}

/** Busca contrato e valida existência. */
async function getContract(contractId) {
  const contract = await prisma.contracts.findUnique({ where: { id: contractId } });
  if (!contract) {
    const err = new Error('Contrato não encontrado.'); err.statusCode = 404; err.code = 'CONTRACT_NOT_FOUND'; throw err;
  }
  return contract;
}

/** Busca aditivo e valida existência. */
async function getAdditive(id) {
  const additive = await repository.findById(id);
  if (!additive) {
    const err = new Error('Aditivo não encontrado.'); err.statusCode = 404; err.code = 'ADDITIVE_NOT_FOUND'; throw err;
  }
  return additive;
}

// ─── operações públicas ──────────────────────────────────────────────────────

async function list(contractId, actor) {
  const contract = await getContract(contractId);
  await assertContractAccess(contract, actor);
  return repository.list(contractId);
}

async function findById(id, actor) {
  const additive = await getAdditive(id);
  const contract = await getContract(additive.contract.id);
  await assertContractAccess(contract, actor);
  return additive;
}

async function create(contractId, data, actor) {
  const contract = await getContract(contractId);
  await assertContractAccess(contract, actor);

  const errors = validation.validateCreate(data);
  if (errors.length > 0) {
    const err = new Error('Dados inválidos.'); err.statusCode = 400; err.code = 'VALIDATION_ERROR'; err.details = errors; throw err;
  }

  // Validar services referenciados
  const services = data.services || [];
  for (const svc of services) {
    const exists = await prisma.services.findUnique({ where: { id: svc.service_id }, select: { id: true, active: true } });
    if (!exists || !exists.active) {
      const err = new Error(`Serviço ${svc.service_id} não encontrado ou inativo.`);
      err.statusCode = 404; err.code = 'SERVICE_NOT_FOUND'; throw err;
    }
  }

  const version = await repository.nextVersionNumber(contractId);

  const additive = await repository.create({
    contract_id:    contractId,
    version_number: version,
    reason:         data.reason.trim(),
    status:         'DRAFT',
    created_by:     actor.id,
  });

  if (services.length > 0) {
    await repository.addServices(additive.id, services.map(s => ({
      service_id:      s.service_id,
      quantity_change: s.quantity_change ?? null,
      new_unit_price:  s.new_unit_price  ?? null,
    })));
  }

  const result = await repository.findById(additive.id);

  await audit({ actorId: actor.id, action: 'CREATE_ADDITIVE', entityId: additive.id, newValues: { version, reason: data.reason } });

  return result;
}

async function update(id, data, actor) {
  const additive = await getAdditive(id);
  const contract = await getContract(additive.contract.id);
  await assertContractAccess(contract, actor);

  // D-04: somente DRAFT é editável
  if (additive.status !== 'DRAFT') {
    const err = new Error('Somente aditivos em DRAFT podem ser editados.'); err.statusCode = 403; err.code = 'ADDITIVE_NOT_DRAFT'; throw err;
  }

  // D-02: somente o criador pode editar (sem exceção para ADMIN)
  if (additive.created_by !== actor.id) {
    const err = new Error('Somente o criador pode editar este aditivo.'); err.statusCode = 403; err.code = 'NOT_CREATOR'; throw err;
  }

  const errors = validation.validateUpdate(data);
  if (errors.length > 0) {
    const err = new Error('Dados inválidos.'); err.statusCode = 400; err.code = 'VALIDATION_ERROR'; err.details = errors; throw err;
  }

  const oldValues = { reason: additive.reason };

  if (data.reason !== undefined) {
    await repository.update(id, { reason: data.reason.trim() });
  }

  if (data.services !== undefined) {
    // Valida serviços
    for (const svc of data.services) {
      const exists = await prisma.services.findUnique({ where: { id: svc.service_id }, select: { id: true, active: true } });
      if (!exists || !exists.active) {
        const err = new Error(`Serviço ${svc.service_id} não encontrado ou inativo.`);
        err.statusCode = 404; err.code = 'SERVICE_NOT_FOUND'; throw err;
      }
    }
    await repository.clearServices(id);
    if (data.services.length > 0) {
      await repository.addServices(id, data.services.map(s => ({
        service_id:      s.service_id,
        quantity_change: s.quantity_change ?? null,
        new_unit_price:  s.new_unit_price  ?? null,
      })));
    }
  }

  const result = await repository.findById(id);
  await audit({ actorId: actor.id, action: 'UPDATE_ADDITIVE', entityId: id, oldValues, newValues: data });
  return result;
}

async function submit(id, actor) {
  const additive = await getAdditive(id);

  if (additive.status !== 'DRAFT') {
    const err = new Error('Somente aditivos em DRAFT podem ser submetidos.'); err.statusCode = 400; err.code = 'INVALID_STATUS_TRANSITION'; throw err;
  }

  // D-02: somente o criador pode submeter (sem exceção para ADMIN)
  if (additive.created_by !== actor.id) {
    const err = new Error('Somente o criador pode submeter este aditivo.'); err.statusCode = 403; err.code = 'NOT_CREATOR'; throw err;
  }

  const old = additive.status;
  const result = await repository.update(id, { status: 'PENDING_APPROVAL' });
  await audit({ actorId: actor.id, action: 'SUBMIT_ADDITIVE', entityId: id, oldValues: { status: old }, newValues: { status: 'PENDING_APPROVAL' } });
  return result;
}

async function approve(id, actor) {
  const additive = await getAdditive(id);

  if (additive.status !== 'PENDING_APPROVAL') {
    const err = new Error('Somente aditivos em PENDING_APPROVAL podem ser aprovados.'); err.statusCode = 400; err.code = 'INVALID_STATUS_TRANSITION'; throw err;
  }

  const old = additive.status;
  await repository.approveTransaction(id, actor.id);
  await audit({ actorId: actor.id, action: 'APPROVE_ADDITIVE', entityId: id, oldValues: { status: old }, newValues: { status: 'APPROVED' } });

  return repository.findById(id);
}

async function reject(id, data, actor) {
  const additive = await getAdditive(id);

  if (additive.status !== 'PENDING_APPROVAL') {
    const err = new Error('Somente aditivos em PENDING_APPROVAL podem ser rejeitados.'); err.statusCode = 400; err.code = 'INVALID_STATUS_TRANSITION'; throw err;
  }

  const errors = validation.validateReject(data);
  if (errors.length > 0) {
    const err = new Error('Dados inválidos.'); err.statusCode = 400; err.code = 'VALIDATION_ERROR'; err.details = errors; throw err;
  }

  const old = additive.status;
  const result = await repository.update(id, {
    status:           'REJECTED',
    rejection_reason: data.reason.trim(),
    rejected_at:      new Date(),
  });
  await audit({ actorId: actor.id, action: 'REJECT_ADDITIVE', entityId: id, oldValues: { status: old }, newValues: { status: 'REJECTED', rejection_reason: data.reason } });
  return result;
}

async function cancel(id, actor) {
  const additive = await getAdditive(id);

  // D-03: somente DRAFT pode ser cancelado, e somente pelo criador
  if (additive.status !== 'DRAFT') {
    const err = new Error('Somente aditivos em DRAFT podem ser cancelados.'); err.statusCode = 400; err.code = 'INVALID_STATUS_TRANSITION'; throw err;
  }

  // D-03: somente o criador pode cancelar em DRAFT (sem exceção para ADMIN)
  if (additive.created_by !== actor.id) {
    const err = new Error('Somente o criador pode cancelar este aditivo.'); err.statusCode = 403; err.code = 'NOT_CREATOR'; throw err;
  }

  const old = additive.status;
  const result = await repository.update(id, { status: 'CANCELLED' });
  await audit({ actorId: actor.id, action: 'CANCEL_ADDITIVE', entityId: id, oldValues: { status: old }, newValues: { status: 'CANCELLED' } });
  return result;
}

module.exports = { list, findById, create, update, submit, approve, reject, cancel };
