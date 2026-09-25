'use strict';

/**
 * Service de Empreiteiros
 *
 * Referência: Documento 1 — M03
 *             Documento 3 — §13, §14
 *             Documento 5 — §10 (permissões), §34 (acesso por empreiteiro)
 *             P-04 A: document opcional, único quando informado
 *
 * Filtro por perfil (Doc5 §10, §34):
 *   ADMIN / DIRECTOR → todos os empreiteiros
 *   COORDINATOR / FISCAL / RESPONSIBLE → empreiteiros das obras vinculadas
 *   CONTRACTOR → somente os próprios dados
 */

const repo   = require('./contractors.repository');
const prisma = require('../../config/prisma');

// ─── helpers internos ─────────────────────────────────────────────────────────

function formatContractor(c) {
  if (!c) return null;
  return {
    id:         c.id,
    name:       c.name,
    document:   c.document,
    email:      c.email,
    phone:      c.phone,
    active:     c.active,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id:     actorId || null,
      action,
      entity_type: 'contractor',
      entity_id:   entityId,
      old_values:  oldValues || null,
      new_values:  newValues || null,
    },
  });
}

/** Lança 404 se o empreiteiro não existir */
async function assertExists(id) {
  const c = await repo.findById(id);
  if (!c) {
    const err = new Error('Empreiteiro não encontrado.');
    err.statusCode = 404;
    err.code = 'CONTRACTOR_NOT_FOUND';
    throw err;
  }
  return c;
}

/**
 * Verifica se o ator tem acesso ao empreiteiro.
 *
 * Regras (Doc5 §10, §34):
 *   ADMIN / DIRECTOR → acesso irrestrito
 *   COORDINATOR / FISCAL / RESPONSIBLE → somente empreiteiros das obras vinculadas ao ator
 *   CONTRACTOR → somente os próprios dados
 */
async function canAccessContractor(actor, contractorId) {
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) return true;

  // CONTRACTOR: acessa somente o empreiteiro ao qual está vinculado (via banco — imutável pelo frontend)
  if (actor.roles.includes('CONTRACTOR')) {
    return actor.contractor_id !== null && actor.contractor_id === contractorId;
  }

  // COORDINATOR / FISCAL / RESPONSIBLE: verificar se o empreiteiro está em alguma obra do ator
  const workLinks = await prisma.user_works.findMany({
    where:  { user_id: actor.id },
    select: { work_id: true },
  });
  const workIds = workLinks.map(l => l.work_id);
  if (workIds.length === 0) return false;

  const contractorIds = await repo.getContractorIdsByWorkIds(workIds);
  return contractorIds.includes(contractorId);
}

async function assertCanAccess(actor, contractorId) {
  const ok = await canAccessContractor(actor, contractorId);
  if (!ok) {
    const err = new Error('Você não tem acesso a este empreiteiro.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/**
 * Verifica unicidade de document antes de criar/atualizar.
 * Proteção amigável — o banco também garante via constraint @unique (P-04 A).
 */
async function assertDocumentUnique(document, excludeId = null) {
  if (!document || !document.trim()) return; // nulo ou vazio → sem verificação

  const existing = await repo.findByDocument(document.trim());
  if (existing && existing.id !== excludeId) {
    const err = new Error('Já existe um empreiteiro com este documento (CPF/CNPJ).');
    err.statusCode = 409;
    err.code = 'DOCUMENT_ALREADY_EXISTS';
    throw err;
  }
}

// ─── operações ───────────────────────────────────────────────────────────────

/**
 * Lista empreiteiros com filtro por perfil.
 */
async function listContractors(params, actor) {
  // ADMIN / DIRECTOR: sem restrição
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) {
    return repo.findMany({ ...params, contractorIds: null });
  }

  // CONTRACTOR: somente os próprios dados via contractor_id do token (fonte confiável)
  // O contractor_id vem de req.user (carregado do banco pelo authenticate.js)
  // Nunca aceitar contractor_id enviado pelo frontend — risco de falsificação de identidade
  if (actor.roles.includes('CONTRACTOR')) {
    if (!actor.contractor_id) {
      // Usuário com perfil CONTRACTOR sem empreiteiro vinculado — estado de dados incompletos
      return { data: [], pagination: { page: params.page || 1, limit: params.limit || 20, total: 0, totalPages: 0 } };
    }
    const c = await repo.findById(actor.contractor_id);
    return {
      data:       c ? [formatContractor(c)] : [],
      pagination: { page: 1, limit: 1, total: c ? 1 : 0, totalPages: c ? 1 : 0 },
    };
  }

  // COORDINATOR / FISCAL / RESPONSIBLE: somente empreiteiros das obras vinculadas
  const workLinks = await prisma.user_works.findMany({
    where:  { user_id: actor.id },
    select: { work_id: true },
  });
  const workIds = workLinks.map(l => l.work_id);

  if (workIds.length === 0) {
    return { data: [], pagination: { page: params.page || 1, limit: params.limit || 20, total: 0, totalPages: 0 } };
  }

  const contractorIds = await repo.getContractorIdsByWorkIds(workIds);
  return repo.findMany({ ...params, contractorIds });
}

/**
 * Busca empreiteiro por ID com controle de acesso.
 */
async function getContractorById(id, actor) {
  await assertExists(id);
  await assertCanAccess(actor, id);
  return formatContractor(await repo.findById(id));
}

/**
 * Cria empreiteiro. Admin e Coordinator (Doc5 §10).
 * Auditoria: CREATE_CONTRACTOR.
 */
async function createContractor(data, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem criar empreiteiros.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  await assertDocumentUnique(data.document);

  let contractor;
  try {
    contractor = await repo.create({
      name:     data.name,
      document: data.document,
      email:    data.email,
      phone:    data.phone,
    });
  } catch (err) {
    // Tratamento do erro P2002 do Prisma (constraint unique — fallback de integridade)
    if (err.code === 'P2002' && err.meta?.target?.includes('document')) {
      const e = new Error('Já existe um empreiteiro com este documento (CPF/CNPJ).');
      e.statusCode = 409;
      e.code = 'DOCUMENT_ALREADY_EXISTS';
      throw e;
    }
    throw err;
  }

  await audit({
    actorId:   actor.id,
    action:    'CREATE_CONTRACTOR',
    entityId:  contractor.id,
    newValues: { name: contractor.name, document: contractor.document },
  });

  return formatContractor(contractor);
}

/**
 * Atualiza empreiteiro. Admin e Coordinator vinculado (Doc5 §10).
 * Auditoria: UPDATE_CONTRACTOR.
 */
async function updateContractor(id, data, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem atualizar empreiteiros.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const existing = await assertExists(id);

  // Coordinator: somente empreiteiros de suas obras
  if (!actor.roles.includes('ADMIN')) {
    await assertCanAccess(actor, id);
  }

  await assertDocumentUnique(data.document, id);

  const oldValues = { name: existing.name, document: existing.document };

  let updated;
  try {
    updated = await repo.update(id, data);
  } catch (err) {
    if (err.code === 'P2002' && err.meta?.target?.includes('document')) {
      const e = new Error('Já existe um empreiteiro com este documento (CPF/CNPJ).');
      e.statusCode = 409;
      e.code = 'DOCUMENT_ALREADY_EXISTS';
      throw e;
    }
    throw err;
  }

  await audit({
    actorId:   actor.id,
    action:    'UPDATE_CONTRACTOR',
    entityId:  id,
    oldValues,
    newValues: { name: updated.name, document: updated.document },
  });

  return formatContractor(updated);
}

/**
 * Ativa ou inativa empreiteiro. Somente Admin (Doc5 §10: "controle completo cadastral").
 * Auditoria: ENABLE_CONTRACTOR / DISABLE_CONTRACTOR.
 */
async function setContractorStatus(id, active, actor) {
  if (!actor.roles.includes('ADMIN')) {
    const err = new Error('Somente o Administrador pode ativar ou inativar empreiteiros.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const existing = await assertExists(id);

  if (existing.active === active) {
    const state = active ? 'ativo' : 'inativo';
    const err = new Error(`O empreiteiro já está ${state}.`);
    err.statusCode = 409;
    err.code = 'STATUS_UNCHANGED';
    throw err;
  }

  const updated = await repo.setStatus(id, active);

  await audit({
    actorId:   actor.id,
    action:    active ? 'ENABLE_CONTRACTOR' : 'DISABLE_CONTRACTOR',
    entityId:  id,
    oldValues: { active: existing.active },
    newValues: { active: updated.active },
  });

  return formatContractor(updated);
}

/**
 * Obras ativas vinculadas a um empreiteiro (Doc4 §12.5).
 * Filtradas pelo acesso do ator.
 */
async function getWorksByContractor(id, actor) {
  await assertExists(id);
  await assertCanAccess(actor, id);

  const works = await repo.findWorksByContractor(id);

  // Para não-Admin/Diretor, filtrar somente obras que o ator também acessa
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) {
    return works;
  }

  const actorWorkLinks = await prisma.user_works.findMany({
    where:  { user_id: actor.id },
    select: { work_id: true },
  });
  const actorWorkIds = new Set(actorWorkLinks.map(l => l.work_id));
  return works.filter(w => actorWorkIds.has(w.id));
}

module.exports = {
  listContractors,
  getContractorById,
  createContractor,
  updateContractor,
  setContractorStatus,
  getWorksByContractor,
};
