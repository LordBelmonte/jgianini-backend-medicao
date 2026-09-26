'use strict';
const prisma = require('../../config/prisma');
const repository = require('./contracts.repository');
const validation = require('./contracts.validation');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE CONTRATOS
// Responsável por todas as regras de negócio e orquestração.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auditoria padrão do sistema.
 */
async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id: actorId || null,
      action,
      entity_type: 'contract',
      entity_id: entityId,
      old_values: oldValues || null,
      new_values: newValues || null,
    },
  });
}

/**
 * Verifica se um contrato é operacional (P-13 + CONFLITO-01).
 * Contrato operacional somente quando:
 *   status = ACTIVE
 *   E (sem start_date OU data atual >= start_date)
 *   E (sem end_date OU data atual <= end_date)
 */
function isContractOperational(contract) {
  const now = new Date();

  // P-13: status permite operação? Somente ACTIVE.
  if (contract.status !== 'ACTIVE') {
    return false;
  }

  // CONFLITO-01: dentro da vigência?
  const withinValidity =
    (!contract.start_date || contract.start_date <= now) &&
    (!contract.end_date   || contract.end_date   >= now);

  return withinValidity;
}

/**
 * Verifica se o usuário pode executar transição de status (P-23).
 * Coordinator, Director e Responsible podem executar transições.
 * Admin sempre pode.
 */
function canExecuteStatusTransition(actor, from, to) {
  // Admin pode tudo
  if (actor.roles.includes('ADMIN')) {
    return true;
  }

  // P-23: Coordinator, Director e Responsible podem executar transições
  const allowedRoles = ['COORDINATOR', 'DIRECTOR', 'RESPONSIBLE'];
  const hasAllowedRole = actor.roles.some(r => allowedRoles.includes(r));

  if (!hasAllowedRole) {
    return false;
  }

  // Verificar transição específica (algumas restrições adicionais poderiam ser adicionadas)
  // Por enquanto, todas as transições permitidas pela validação são permitidas para esses perfis
  return true;
}

/**
 * Lista contratos com autorização contextual.
 */
async function list({ page, limit, actor, workId, contractorId }) {
  // Permission check é feita no middleware requirePermission
  return repository.list({ page, limit, actor, workId, contractorId });
}

/**
 * Busca contrato por ID com autorização.
 */
async function findById(id, actor) {
  const contract = await repository.findById(id, actor);

  if (!contract) {
    const err = new Error('Contrato não encontrado.');
    err.statusCode = 404;
    err.code = 'CONTRACT_NOT_FOUND';
    throw err;
  }

  return contract;
}

/**
 * Cria contrato (P-16, P-17, P-18).
 */
async function create(data, actor) {
  // Validação de entrada
  const validationErrors = validation.validateCreate(data);
  if (validationErrors.length > 0) {
    const err = new Error('Dados inválidos.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationErrors;
    throw err;
  }

  // P-21: contract_number único dentro da obra
  const exists = await repository.contractNumberExists(data.work_id, data.contract_number);
  if (exists) {
    const err = new Error('Número de contrato já existe nesta obra.');
    err.statusCode = 409;
    err.code = 'CONTRACT_NUMBER_DUPLICATE';
    throw err;
  }

  // Status inicial é DRAFT (P-18) — garantido pelo schema default
  // Mas explicitamos aqui
  const contractData = {
    ...data,
    status: 'DRAFT',
    created_by: actor.id, // obrigatório
  };

  const contract = await repository.create(contractData);

  // Auditoria
  await audit({
    actorId: actor.id,
    action: 'CREATE_CONTRACT',
    entityId: contract.id,
    newValues: contract,
  });

  return contract;
}

/**
 * Atualiza dados administrativos do contrato (P-22, P-25).
 */
async function update(id, data, actor) {
  const contract = await findById(id, actor);

  // Validação de entrada
  const validationErrors = validation.validateUpdate(data);
  if (validationErrors.length > 0) {
    const err = new Error('Dados inválidos.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationErrors;
    throw err;
  }

  // P-12: após uso, alterações de preço, quantidade, serviço exigem Aditivo
  // Mas esta atualização é apenas para campos administrativos (notes, dates, retention)
  // P-25: retenção pode ser alterada diretamente, mesmo com contrato em uso
  const oldValues = {
    notes: contract.notes,
    start_date: contract.start_date,
    end_date: contract.end_date,
    retention_percent: contract.retention_percent,
  };

  const updated = await repository.update(id, data);

  // Auditoria
  await audit({
    actorId: actor.id,
    action: 'UPDATE_CONTRACT',
    entityId: id,
    oldValues,
    newValues: data,
  });

  return updated;
}

/**
 * Executa transição de status (P-09, P-23).
 */
async function transitionStatus(id, newStatus, actor) {
  const contract = await findById(id, actor);

  // Valida transição
  const transitionError = validation.validateStatusTransition(contract.status, newStatus);
  if (transitionError) {
    const err = new Error(transitionError);
    err.statusCode = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }

  // Verifica autorização para transição
  if (!canExecuteStatusTransition(actor, contract.status, newStatus)) {
    const err = new Error('Você não tem permissão para executar esta transição.');
    err.statusCode = 403;
    err.code = 'UNAUTHORIZED_TRANSITION';
    throw err;
  }

  const oldStatus = contract.status;
  const updated = await repository.updateStatus(id, newStatus);

  // Auditoria com ação específica
  const actionMap = {
    'DRAFT→ACTIVE': 'ACTIVATE_CONTRACT',
    'ACTIVE→SUSPENDED': 'SUSPEND_CONTRACT',
    'SUSPENDED→ACTIVE': 'RESUME_CONTRACT',
    'ACTIVE→CLOSED': 'CLOSE_CONTRACT',
    'SUSPENDED→CLOSED': 'CLOSE_CONTRACT',
  };
  const actionKey = `${oldStatus}→${newStatus}`;
  const auditAction = actionMap[actionKey] || 'UPDATE_CONTRACT_STATUS';

  await audit({
    actorId: actor.id,
    action: auditAction,
    entityId: id,
    oldValues: { status: oldStatus },
    newValues: { status: newStatus },
  });

  return updated;
}

/**
 * Adiciona serviço ao contrato (P-16).
 * Q1 — Permitido em DRAFT, ACTIVE, SUSPENDED. Bloqueado somente em CLOSED.
 */
async function addService(contractId, serviceData, actor) {
  const contract = await findById(contractId, actor);

  // Q4: CLOSED bloqueia toda alteração de contract_services
  if (contract.status === 'CLOSED') {
    const err = new Error('Não é possível adicionar serviços em contratos encerrados (CLOSED).');
    err.statusCode = 403;
    err.code = 'CONTRACT_CLOSED';
    throw err;
  }

  // Validação do serviço
  const validationErrors = validation.validateServiceCreate(serviceData);
  if (validationErrors.length > 0) {
    const err = new Error('Dados do serviço inválidos.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationErrors;
    throw err;
  }

  // Verificar se o serviço existe
  const service = await prisma.services.findUnique({
    where: { id: serviceData.service_id },
    select: { id: true, active: true },
  });

  if (!service || !service.active) {
    const err = new Error('Serviço não encontrado ou inativo.');
    err.statusCode = 404;
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }

  const serviceToAdd = {
    ...serviceData,
    active: true,
  };

  const contractService = await repository.addService(contractId, serviceToAdd);

  // Auditoria
  await audit({
    actorId: actor.id,
    action: 'ADD_CONTRACT_SERVICE',
    entityId: contractId,
    newValues: contractService,
  });

  return contractService;
}

/**
 * Atualiza serviço do contrato.
 * Q2 — Permitido em DRAFT, ACTIVE, SUSPENDED. Bloqueado somente em CLOSED.
 */
async function updateService(serviceId, data, actor) {
  const contractService = await repository.findServiceById(serviceId);

  if (!contractService) {
    const err = new Error('Serviço do contrato não encontrado.');
    err.statusCode = 404;
    err.code = 'CONTRACT_SERVICE_NOT_FOUND';
    throw err;
  }

  const contract = await findById(contractService.contract.id, actor);

  // Q4: CLOSED bloqueia toda alteração de contract_services
  if (contract.status === 'CLOSED') {
    const err = new Error('Não é possível alterar serviços em contratos encerrados (CLOSED).');
    err.statusCode = 403;
    err.code = 'CONTRACT_CLOSED';
    throw err;
  }

  // Validação
  const validationErrors = validation.validateServiceUpdate(data);
  if (validationErrors.length > 0) {
    const err = new Error('Dados do serviço inválidos.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationErrors;
    throw err;
  }

  const oldValues = {
    quantity:   contractService.quantity,
    unit_price: contractService.unit_price,
  };

  const updated = await repository.updateService(serviceId, data);

  // Auditoria
  await audit({
    actorId: actor.id,
    action: 'UPDATE_CONTRACT_SERVICE',
    entityId: contractService.contract.id,
    oldValues,
    newValues: data,
  });

  return updated;
}

/**
 * Remove (soft-delete) serviço do contrato. (Q5 — sempre active=false, nunca DELETE físico)
 * Q2 — Permitido em DRAFT, ACTIVE, SUSPENDED. Bloqueado somente em CLOSED.
 */
async function removeService(serviceId, actor) {
  const contractService = await repository.findServiceById(serviceId);

  if (!contractService) {
    const err = new Error('Serviço do contrato não encontrado.');
    err.statusCode = 404;
    err.code = 'CONTRACT_SERVICE_NOT_FOUND';
    throw err;
  }

  const contract = await findById(contractService.contract.id, actor);

  // Q4: CLOSED bloqueia toda alteração de contract_services
  if (contract.status === 'CLOSED') {
    const err = new Error('Não é possível remover serviços em contratos encerrados (CLOSED).');
    err.statusCode = 403;
    err.code = 'CONTRACT_CLOSED';
    throw err;
  }

  const removed = await repository.removeService(serviceId);

  // Auditoria
  await audit({
    actorId: actor.id,
    action: 'REMOVE_CONTRACT_SERVICE',
    entityId: contract.id,
    oldValues: contractService,
  });

  return removed;
}

/**
 * Lista serviços ativos do contrato.
 */
async function listServices(contractId, actor) {
  await findById(contractId, actor); // Verifica acesso
  return repository.listContractServices(contractId);
}

/**
 * Consulta saldo do contrato (P-26).
 */
async function getBalance(contractId, actor) {
  await findById(contractId, actor); // Verifica acesso
  return repository.calculateBalance(contractId);
}

/**
 * Verifica se contrato existe e usuário tem acesso (função auxiliar).
 */
async function getContractForValidation(id, actor) {
  return findById(id, actor);
}

module.exports = {
  audit,
  isContractOperational,
  canExecuteStatusTransition,
  list,
  findById,
  create,
  update,
  transitionStatus,
  addService,
  updateService,
  removeService,
  listServices,
  getBalance,
  getContractForValidation,
};