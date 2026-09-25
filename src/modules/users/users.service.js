'use strict';

/**
 * Service de Usuários
 *
 * Referência: Documento 1 — seções 3, 29, 34
 *             Documento 2 — seção 6 (responsabilidades do Service)
 *             Documento 3 — §6, §9, §12, §40-§41
 *             Documento 5 — §8 (permissões por perfil)
 *
 * Responsabilidades:
 *   - Aplicar regras de negócio
 *   - Verificar unicidade de email
 *   - Verificar existência de roles antes de vincular
 *   - Gerar registros de auditoria
 *   - Chamar o Repository para persistência
 *
 * NÃO acessa Prisma diretamente — usa o Repository.
 * NÃO valida formato/estrutura — essa é responsabilidade da Validation.
 */

const usersRepository = require('./users.repository');
const { hashPassword } = require('../auth/auth.service');
const prisma = require('../../config/prisma');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Formata o usuário para resposta — nunca retorna password_hash.
 */
function formatUser(user) {
  if (!user) return null;
  const roles = (user.user_roles || []).map(ur => ({
    id:   ur.role.id,
    name: ur.role.name,
  }));
  return {
    id:         user.id,
    name:       user.name,
    email:      user.email,
    active:     user.active,
    roles,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

/**
 * Registra auditoria de operações de usuário (Doc3 §40-§41, Doc1 §29-§30)
 */
async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: {
      user_id:     actorId || null,
      action,
      entity_type: 'user',
      entity_id:   entityId,
      old_values:  oldValues  || null,
      new_values:  newValues  || null,
    },
  });
}

/**
 * Verifica se todos os roleIds existem no banco.
 * Lança erro 422 se algum não existir.
 */
async function validateRolesExist(roleIds) {
  if (!roleIds || roleIds.length === 0) return;

  const found = await prisma.roles.findMany({
    where: { id: { in: roleIds } },
    select: { id: true },
  });

  if (found.length !== roleIds.length) {
    const foundIds  = found.map(r => r.id);
    const missing   = roleIds.filter(id => !foundIds.includes(id));
    const err = new Error(`Perfil(is) não encontrado(s): ${missing.join(', ')}`);
    err.statusCode = 422;
    err.code = 'ROLE_NOT_FOUND';
    throw err;
  }
}

// ─── operações ───────────────────────────────────────────────────────────────

/**
 * Lista usuários com filtros e paginação.
 * Se o solicitante for EMPREITEIRO (CONTRACTOR), retorna somente os próprios dados (Doc5 §8).
 *
 * @param {object} params - filtros e paginação validados
 * @param {object} actor  - req.user (usuário autenticado)
 */
async function listUsers(params, actor) {
  // Empreiteiro vê somente os próprios dados (Doc5 §8)
  const isContractor = actor.roles.includes('CONTRACTOR');
  if (isContractor) {
    const user = await usersRepository.findById(actor.id);
    return {
      data: [formatUser(user)],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    };
  }

  const result = await usersRepository.findMany(params);
  return {
    data:       result.data.map(formatUser),
    pagination: result.pagination,
  };
}

/**
 * Busca usuário por ID.
 * Empreiteiro só pode ver os próprios dados (Doc5 §8).
 *
 * @param {string} id
 * @param {object} actor
 */
async function getUserById(id, actor) {
  const isContractor = actor.roles.includes('CONTRACTOR');
  if (isContractor && actor.id !== id) {
    const err = new Error('Você não tem acesso a este usuário.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const user = await usersRepository.findById(id);
  if (!user) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  return formatUser(user);
}

/**
 * Cria um novo usuário.
 * Somente ADMIN pode criar (Doc5 §8).
 * Verificações: email único, roles existem.
 * Auditoria: CREATE_USER.
 *
 * @param {{ name, email, password, roleIds? }} data
 * @param {object} actor
 */
async function createUser(data, actor) {
  const { name, email, password, roleIds = [] } = data;

  // Verificar email único
  const existing = await usersRepository.findByEmail(email);
  if (existing) {
    const err = new Error('Já existe um usuário cadastrado com este e-mail.');
    err.statusCode = 409;
    err.code = 'EMAIL_ALREADY_EXISTS';
    throw err;
  }

  // Verificar roles existem
  await validateRolesExist(roleIds);

  // Hash da senha (reutiliza hashPassword do auth.service — sem duplicação)
  const password_hash = await hashPassword(password);

  const user = await usersRepository.create({
    name:          name.trim(),
    email,
    password_hash,
    active:        true,
    roleIds,
  });

  await audit({
    actorId:   actor.id,
    action:    'CREATE_USER',
    entityId:  user.id,
    newValues: { name: user.name, email: user.email, active: user.active },
  });

  return formatUser(user);
}

/**
 * Atualiza dados de um usuário.
 * Verificações: usuário existe, email único se alterado, roles existem.
 * Auditoria: UPDATE_USER.
 *
 * @param {string} id
 * @param {{ name?, email?, password?, roleIds? }} data
 * @param {object} actor
 */
async function updateUser(id, data, actor) {
  const existing = await usersRepository.findById(id);
  if (!existing) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const oldValues = { name: existing.name, email: existing.email };
  const updateData = {};

  if (data.name !== undefined)     updateData.name = data.name.trim();

  if (data.email !== undefined) {
    const emailLower = data.email.toLowerCase().trim();
    if (emailLower !== existing.email) {
      const conflict = await usersRepository.findByEmail(emailLower);
      if (conflict) {
        const err = new Error('Já existe um usuário cadastrado com este e-mail.');
        err.statusCode = 409;
        err.code = 'EMAIL_ALREADY_EXISTS';
        throw err;
      }
    }
    updateData.email = emailLower;
  }

  if (data.password !== undefined) {
    updateData.password_hash = await hashPassword(data.password);
  }

  // Atualiza dados básicos se houver
  let updatedUser = existing;
  if (Object.keys(updateData).length > 0) {
    updatedUser = await usersRepository.update(id, updateData);
  }

  // Atualiza perfis se informado
  if (data.roleIds !== undefined) {
    await validateRolesExist(data.roleIds);
    updatedUser = await usersRepository.setRoles(id, data.roleIds);
  }

  const newValues = { name: updatedUser.name, email: updatedUser.email };

  await audit({
    actorId:   actor.id,
    action:    'UPDATE_USER',
    entityId:  id,
    oldValues,
    newValues,
  });

  return formatUser(updatedUser);
}

/**
 * Ativa ou desativa um usuário (Doc3 §6, Doc4 §9.5).
 * Nunca exclui fisicamente (Doc3 §43).
 * Auditoria: ENABLE_USER / DISABLE_USER.
 *
 * @param {string} id
 * @param {boolean} active
 * @param {object} actor
 */
async function setUserStatus(id, active, actor) {
  const existing = await usersRepository.findById(id);
  if (!existing) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  if (existing.active === active) {
    const state = active ? 'ativo' : 'inativo';
    const err = new Error(`O usuário já está ${state}.`);
    err.statusCode = 409;
    err.code = 'STATUS_UNCHANGED';
    throw err;
  }

  const updated = await usersRepository.setStatus(id, active);

  await audit({
    actorId:   actor.id,
    action:    active ? 'ENABLE_USER' : 'DISABLE_USER',
    entityId:  id,
    oldValues: { active: existing.active },
    newValues: { active: updated.active },
  });

  return formatUser(updated);
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  setUserStatus,
};
