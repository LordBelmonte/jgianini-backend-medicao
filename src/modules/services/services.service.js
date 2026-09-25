'use strict';

/**
 * Service de Serviços
 *
 * Referência: Documento 1 — §5-M05
 *             Documento 3 — §15
 *             Documento 5 — §11 (permissões), §6 (Matriz Geral)
 *             Documento 7 — §3 (unidades)
 *
 * "Serviços são dados estruturais do sistema." (Doc5 §11)
 *
 * Regras de acesso:
 *   ADMIN / DIRECTOR → todos os serviços sem restrição
 *   COORDINATOR / FISCAL / RESPONSIBLE → todos (sem restrição de obra — dados estruturais)
 *   CONTRACTOR → somente serviços de seus contratos ativos (Doc5 §11, §4.6)
 *
 * Pendências em aberto (NÃO resolver aqui):
 *   P-05: alteração de code após uso em medição → resolver antes de Medições
 *   P-06: quantity inteiro para M2 → resolver antes de Medições
 */

const repo   = require('./services.repository');
const prisma = require('../../config/prisma');

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatService(s) {
  if (!s) return null;
  return {
    id:          s.id,
    code:        s.code,
    name:        s.name,
    unit:        s.unit,
    requires_al: s.requires_al,
    active:      s.active,
    created_at:  s.created_at,
    updated_at:  s.updated_at,
  };
}

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id:     actorId || null,
      action,
      entity_type: 'service',
      entity_id:   entityId,
      old_values:  oldValues || null,
      new_values:  newValues || null,
    },
  });
}

async function assertExists(id) {
  const s = await repo.findById(id);
  if (!s) {
    const err = new Error('Serviço não encontrado.');
    err.statusCode = 404;
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }
  return s;
}

// ─── operações ───────────────────────────────────────────────────────────────

/**
 * Lista serviços.
 *
 * Regra de acesso (Doc5 §11):
 *   CONTRACTOR → somente serviços de seus contratos ativos
 *   Demais → todos (serviços são dados estruturais)
 */
async function listServices(params, actor) {
  if (actor.roles.includes('CONTRACTOR')) {
    if (!actor.contractor_id) {
      return { data: [], pagination: { page: params.page || 1, limit: params.limit || 20, total: 0, totalPages: 0 } };
    }
    const serviceIds = await repo.getServiceIdsByContractorId(actor.contractor_id);
    const result = await repo.findMany({ ...params, serviceIds });
    return { data: result.data.map(formatService), pagination: result.pagination };
  }

  const result = await repo.findMany({ ...params, serviceIds: null });
  return { data: result.data.map(formatService), pagination: result.pagination };
}

/**
 * Busca serviço por ID.
 * Serviços são dados estruturais — sem restrição de vínculo para a maioria dos perfis.
 * CONTRACTOR: verifica se o serviço pertence a algum contrato seu.
 */
async function getServiceById(id, actor) {
  const service = await assertExists(id);

  if (actor.roles.includes('CONTRACTOR')) {
    if (!actor.contractor_id) {
      const err = new Error('Você não tem acesso a este serviço.');
      err.statusCode = 403; err.code = 'FORBIDDEN';
      throw err;
    }
    const serviceIds = await repo.getServiceIdsByContractorId(actor.contractor_id);
    if (!serviceIds.includes(id)) {
      const err = new Error('Você não tem acesso a este serviço.');
      err.statusCode = 403; err.code = 'FORBIDDEN';
      throw err;
    }
  }

  return formatService(service);
}

/**
 * Cria serviço. Admin e Coordinator (Doc5 §11).
 * Auditoria: CREATE_SERVICE.
 */
async function createService(data, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem criar serviços.');
    err.statusCode = 403; err.code = 'FORBIDDEN';
    throw err;
  }

  // Verificar unicidade do code
  const codeUp = data.code.trim().toUpperCase();
  const existing = await repo.findByCode(codeUp);
  if (existing) {
    const err = new Error('Já existe um serviço com este código.');
    err.statusCode = 409; err.code = 'CODE_ALREADY_EXISTS';
    throw err;
  }

  const service = await repo.create({
    code:        data.code,
    name:        data.name,
    unit:        data.unit.toUpperCase(),
    requires_al: data.requiresAl ?? false,
  });

  await audit({
    actorId:   actor.id,
    action:    'CREATE_SERVICE',
    entityId:  service.id,
    newValues: { code: service.code, name: service.name, unit: service.unit, requires_al: service.requires_al },
  });

  return formatService(service);
}

/**
 * Atualiza serviço. Admin e Coordinator (Doc5 §11).
 * Auditoria: UPDATE_SERVICE.
 *
 * Nota P-05: a alteração de `code` após uso em medição está em aberto.
 * Por ora, alteração de code é permitida (sem verificação de uso histórico).
 * Isso será revisado antes da implementação de Medições.
 */
async function updateService(id, data, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem atualizar serviços.');
    err.statusCode = 403; err.code = 'FORBIDDEN';
    throw err;
  }

  const existing = await assertExists(id);

  // Verificar unicidade do novo code (se alterado)
  if (data.code !== undefined) {
    const newCode = data.code.trim().toUpperCase();
    if (newCode !== existing.code) {
      const conflict = await repo.findByCode(newCode);
      if (conflict) {
        const err = new Error('Já existe um serviço com este código.');
        err.statusCode = 409; err.code = 'CODE_ALREADY_EXISTS';
        throw err;
      }
    }
  }

  const oldValues = { code: existing.code, name: existing.name, unit: existing.unit, requires_al: existing.requires_al };

  const updated = await repo.update(id, {
    code:        data.code,
    name:        data.name,
    unit:        data.unit ? data.unit.toUpperCase() : undefined,
    requires_al: data.requiresAl,
  });

  await audit({
    actorId:   actor.id,
    action:    'UPDATE_SERVICE',
    entityId:  id,
    oldValues,
    newValues: { code: updated.code, name: updated.name, unit: updated.unit, requires_al: updated.requires_al },
  });

  return formatService(updated);
}

/**
 * Ativa ou inativa serviço. Admin e Coordinator.
 * Auditoria: ENABLE_SERVICE / DISABLE_SERVICE.
 */
async function setServiceStatus(id, active, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem ativar ou inativar serviços.');
    err.statusCode = 403; err.code = 'FORBIDDEN';
    throw err;
  }

  const existing = await assertExists(id);

  if (existing.active === active) {
    const state = active ? 'ativo' : 'inativo';
    const err = new Error(`O serviço já está ${state}.`);
    err.statusCode = 409; err.code = 'STATUS_UNCHANGED';
    throw err;
  }

  const updated = await repo.setStatus(id, active);

  await audit({
    actorId:   actor.id,
    action:    active ? 'ENABLE_SERVICE' : 'DISABLE_SERVICE',
    entityId:  id,
    oldValues: { active: existing.active },
    newValues: { active: updated.active },
  });

  return formatService(updated);
}

module.exports = { listServices, getServiceById, createService, updateService, setServiceStatus };
