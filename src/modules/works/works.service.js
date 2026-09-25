'use strict';

/**
 * Service de Obras
 *
 * Referência: Documento 1 — seções 3, 29, 34
 *             Documento 2 — seção 6
 *             Documento 3 — §11, §12, §14, §40-§41
 *             Documento 5 — §2, §9, §33 (PERMISSÃO + VÍNCULO = ACESSO EFETIVO)
 *
 * Exporta: canAccessWork() — helper central reutilizado por contratos, ALs, medições e aprovações.
 */

const repo   = require('./works.repository');
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER CENTRAL DE ACESSO — reutilizável por todos os módulos seguintes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se o usuário autenticado tem acesso a uma obra específica.
 *
 * Regra (Doc5 §2, §33):
 *   ADMIN   → acesso irrestrito (sem verificar vínculo)
 *   DIRECTOR → acesso irrestrito (sem verificar vínculo)
 *   demais  → somente obras presentes em user_works
 *
 * @param {object} user   - req.user (injetado pelo middleware authenticate)
 * @param {string} workId - ID da obra a verificar
 * @returns {Promise<boolean>}
 */
async function canAccessWork(user, workId) {
  if (user.roles.includes('ADMIN') || user.roles.includes('DIRECTOR')) return true;

  const link = await prisma.user_works.findUnique({
    where: { user_id_work_id: { user_id: user.id, work_id: workId } },
  });
  return link !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Lança 403 se o usuário não tiver acesso à obra */
async function assertCanAccess(user, workId) {
  const ok = await canAccessWork(user, workId);
  if (!ok) {
    const err = new Error('Você não tem acesso a esta obra.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/** Lança 404 se a obra não existir, retorna a obra */
async function assertWorkExists(workId) {
  const work = await repo.findById(workId);
  if (!work) {
    const err = new Error('Obra não encontrada.');
    err.statusCode = 404;
    err.code = 'WORK_NOT_FOUND';
    throw err;
  }
  return work;
}

/** Auditoria */
async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id:     actorId || null,
      action,
      entity_type: 'work',
      entity_id:   entityId,
      old_values:  oldValues || null,
      new_values:  newValues || null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD DE OBRAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista obras.
 * Admin e Diretor veem todas; demais veem somente as suas (Doc5 §9, §33).
 */
async function listWorks(params, actor) {
  let workIds = null; // null = sem restrição

  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('DIRECTOR')) {
    workIds = await repo.getWorkIdsByUser(actor.id);
  }

  return repo.findMany({ ...params, workIds });
}

/**
 * Busca obra por ID verificando acesso.
 */
async function getWorkById(workId, actor) {
  await assertWorkExists(workId);
  await assertCanAccess(actor, workId);
  return repo.findById(workId);
}

/**
 * Cria obra. Somente Admin pode criar (Doc5 §9).
 * Auditoria: CREATE_WORK.
 */
async function createWork(data, actor) {
  if (!actor.roles.includes('ADMIN')) {
    const err = new Error('Somente o Administrador pode criar obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  // Verificar código único
  const existing = await repo.findByCode(data.code.trim().toUpperCase());
  if (existing) {
    const err = new Error('Já existe uma obra com este código.');
    err.statusCode = 409;
    err.code = 'CODE_ALREADY_EXISTS';
    throw err;
  }

  const work = await repo.create({
    code:        data.code,
    name:        data.name,
    client_name: data.clientName,
    address:     data.address,
  });

  await audit({
    actorId:   actor.id,
    action:    'CREATE_WORK',
    entityId:  work.id,
    newValues: { code: work.code, name: work.name, client_name: work.client_name },
  });

  return work;
}

/**
 * Atualiza obra.
 * Admin pode atualizar qualquer obra.
 * Coordenador pode atualizar somente obras vinculadas (Doc5 §9: "alterações administrativas permitidas").
 * Auditoria: UPDATE_WORK.
 */
async function updateWork(workId, data, actor) {
  const work = await assertWorkExists(workId);
  await assertCanAccess(actor, workId);

  // Se não for Admin, bloquear alteração de código
  if (!actor.roles.includes('ADMIN') && data.code !== undefined) {
    const err = new Error('Somente o Administrador pode alterar o código da obra.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  // Verificar unicidade do novo código (se fornecido)
  if (data.code !== undefined) {
    const newCode = data.code.trim().toUpperCase();
    if (newCode !== work.code) {
      const conflict = await repo.findByCode(newCode);
      if (conflict) {
        const err = new Error('Já existe uma obra com este código.');
        err.statusCode = 409;
        err.code = 'CODE_ALREADY_EXISTS';
        throw err;
      }
    }
  }

  const oldValues = { code: work.code, name: work.name, client_name: work.client_name };
  const updated = await repo.update(workId, {
    code:        data.code,
    name:        data.name,
    client_name: data.clientName,
    address:     data.address,
  });

  await audit({
    actorId:   actor.id,
    action:    'UPDATE_WORK',
    entityId:  workId,
    oldValues,
    newValues: { code: updated.code, name: updated.name, client_name: updated.client_name },
  });

  return updated;
}

/**
 * Ativa ou inativa obra. Somente Admin (Doc5 §9: "ativar/inativar").
 * Auditoria: ENABLE_WORK / DISABLE_WORK.
 */
async function setWorkStatus(workId, active, actor) {
  if (!actor.roles.includes('ADMIN')) {
    const err = new Error('Somente o Administrador pode ativar ou inativar obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const work = await assertWorkExists(workId);
  const currentlyActive = work.status === 'ACTIVE';

  if (currentlyActive === active) {
    const state = active ? 'ativa' : 'inativa';
    const err = new Error(`A obra já está ${state}.`);
    err.statusCode = 409;
    err.code = 'STATUS_UNCHANGED';
    throw err;
  }

  const updated = await repo.setStatus(workId, active);

  await audit({
    actorId:   actor.id,
    action:    active ? 'ENABLE_WORK' : 'DISABLE_WORK',
    entityId:  workId,
    oldValues: { status: work.status },
    newValues: { status: updated.status },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// VÍNCULOS OBRA↔USUÁRIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista usuários de uma obra.
 * Verificar acesso do actor à obra antes de listar.
 */
async function getUsersByWork(workId, actor) {
  await assertWorkExists(workId);
  await assertCanAccess(actor, workId);
  return repo.findUsersByWork(workId);
}

/**
 * Vincula usuário a obra. Somente Admin (Doc5 §8 + §9).
 * Auditoria: LINK_USER_WORK.
 */
async function linkUserToWork(workId, userId, actor) {
  if (!actor.roles.includes('ADMIN')) {
    const err = new Error('Somente o Administrador pode vincular usuários a obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  await assertWorkExists(workId);

  // Verificar que o usuário existe
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  // Verificar duplicidade
  const existing = await repo.findUserWork(workId, userId);
  if (existing) {
    const err = new Error('Este usuário já está vinculado a esta obra.');
    err.statusCode = 409;
    err.code = 'LINK_ALREADY_EXISTS';
    throw err;
  }

  await repo.createUserWork(workId, userId);

  await prisma.audit_logs.create({
    data: {
      user_id:     actor.id,
      action:      'LINK_USER_WORK',
      entity_type: 'work',
      entity_id:   workId,
      new_values:  { user_id: userId, work_id: workId },
    },
  });

  return { work_id: workId, user_id: userId };
}

/**
 * Remove vínculo usuário↔obra. Somente Admin (P-02 Opção A).
 * Não remove o usuário nem a obra.
 * Auditoria: UNLINK_USER_WORK.
 */
async function unlinkUserFromWork(workId, userId, actor) {
  if (!actor.roles.includes('ADMIN')) {
    const err = new Error('Somente o Administrador pode remover vínculos de usuários em obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  await assertWorkExists(workId);

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const link = await repo.findUserWork(workId, userId);
  if (!link) {
    const err = new Error('Este usuário não está vinculado a esta obra.');
    err.statusCode = 404;
    err.code = 'LINK_NOT_FOUND';
    throw err;
  }

  await repo.deleteUserWork(workId, userId);

  await prisma.audit_logs.create({
    data: {
      user_id:     actor.id,
      action:      'UNLINK_USER_WORK',
      entity_type: 'work',
      entity_id:   workId,
      old_values:  { user_id: userId, work_id: workId },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VÍNCULOS OBRA↔EMPREITEIRO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista empreiteiros ativos de uma obra.
 */
async function getContractorsByWork(workId, actor) {
  await assertWorkExists(workId);
  await assertCanAccess(actor, workId);
  return repo.findContractorsByWork(workId);
}

/**
 * Vincula empreiteiro a obra. Admin e Coordenador (Doc5 §9 + §10).
 * Se vínculo existia e estava inativo → reativa (P-03 regra 8).
 * Auditoria: LINK_CONTRACTOR_WORK.
 */
async function linkContractorToWork(workId, contractorId, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem vincular empreiteiros a obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  await assertWorkExists(workId);

  // Verificar que o empreiteiro existe
  const contractor = await prisma.contractors.findUnique({
    where: { id: contractorId },
    select: { id: true, name: true, active: true },
  });
  if (!contractor) {
    const err = new Error('Empreiteiro não encontrado.');
    err.statusCode = 404;
    err.code = 'CONTRACTOR_NOT_FOUND';
    throw err;
  }

  // Verificar duplicidade ativa
  const existing = await repo.findWorkContractor(workId, contractorId);
  if (existing && existing.active) {
    const err = new Error('Este empreiteiro já está vinculado a esta obra.');
    err.statusCode = 409;
    err.code = 'LINK_ALREADY_EXISTS';
    throw err;
  }

  // Cria ou reativa (upsert no repository)
  await repo.upsertWorkContractor(workId, contractorId);

  await prisma.audit_logs.create({
    data: {
      user_id:     actor.id,
      action:      'LINK_CONTRACTOR_WORK',
      entity_type: 'work',
      entity_id:   workId,
      new_values:  { contractor_id: contractorId, work_id: workId },
    },
  });

  return { work_id: workId, contractor_id: contractorId };
}

/**
 * Remove vínculo obra↔empreiteiro com soft-delete (active=false).
 * Admin e Coordenador (P-03 Opção A).
 * Auditoria: UNLINK_CONTRACTOR_WORK.
 */
async function unlinkContractorFromWork(workId, contractorId, actor) {
  const isAdminOrCoord = actor.roles.includes('ADMIN') || actor.roles.includes('COORDINATOR');
  if (!isAdminOrCoord) {
    const err = new Error('Somente o Administrador ou Coordenador podem remover vínculos de empreiteiros em obras.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  await assertWorkExists(workId);

  const link = await repo.findWorkContractor(workId, contractorId);
  if (!link || !link.active) {
    const err = new Error('Este empreiteiro não está vinculado ativamente a esta obra.');
    err.statusCode = 404;
    err.code = 'LINK_NOT_FOUND';
    throw err;
  }

  await repo.deactivateWorkContractor(workId, contractorId);

  await prisma.audit_logs.create({
    data: {
      user_id:     actor.id,
      action:      'UNLINK_CONTRACTOR_WORK',
      entity_type: 'work',
      entity_id:   workId,
      old_values:  { contractor_id: contractorId, work_id: workId, active: true },
    },
  });
}

module.exports = {
  // helper exportável para uso em contratos, ALs, medições
  canAccessWork,
  // CRUD obras
  listWorks,
  getWorkById,
  createWork,
  updateWork,
  setWorkStatus,
  // vínculos usuário↔obra
  getUsersByWork,
  linkUserToWork,
  unlinkUserFromWork,
  // vínculos obra↔empreiteiro
  getContractorsByWork,
  linkContractorToWork,
  unlinkContractorFromWork,
};
