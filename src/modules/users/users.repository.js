'use strict';

/**
 * Repository de Usuários
 *
 * Referência: Documento 2 — seção 7 (responsabilidades do Repository)
 *             Documento 3 — §6 (tabela users), §9 (user_roles), §12 (user_works)
 *
 * Responsabilidade: isolar operações de persistência.
 * NÃO decide regras de negócio — essa responsabilidade é do Service.
 */

const prisma = require('../../config/prisma');

// ─── include padrão para carregar perfis e permissões junto ao usuário ────────
const USER_INCLUDE = {
  user_roles: {
    include: {
      role: {
        include: {
          role_permissions: {
            include: { permission: true },
          },
        },
      },
    },
  },
};

// ─── campos seguros para retorno — nunca expor password_hash ─────────────────
const USER_SELECT = {
  id:         true,
  name:       true,
  email:      true,
  active:     true,
  created_at: true,
  updated_at: true,
  user_roles: {
    include: {
      role: {
        select: {
          id:   true,
          name: true,
        },
      },
    },
  },
};

/**
 * Busca um usuário pelo ID — inclui perfis e permissões.
 * Retorna null se não encontrado.
 */
async function findById(id) {
  return prisma.users.findUnique({
    where: { id },
    include: USER_INCLUDE,
  });
}

/**
 * Busca um usuário pelo email (para login e verificação de duplicidade).
 * Inclui password_hash — use somente internamente no Service.
 */
async function findByEmail(email) {
  return prisma.users.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: USER_INCLUDE,
  });
}

/**
 * Lista usuários com filtros opcionais e paginação.
 * NÃO retorna password_hash.
 *
 * @param {{ name?, email?, role?, active?, page?, limit? }} filters
 */
async function findMany({ name, email, role, active, page = 1, limit = 20 } = {}) {
  const where = {};

  if (name)               where.name   = { contains: name, mode: 'insensitive' };
  if (email)              where.email  = { contains: email, mode: 'insensitive' };
  if (active !== undefined) where.active = active;

  // Filtro por nome do role
  if (role) {
    where.user_roles = {
      some: {
        role: { name: { equals: role, mode: 'insensitive' } },
      },
    };
  }

  const skip  = (page - 1) * limit;
  const take  = limit;

  const [data, total] = await prisma.$transaction([
    prisma.users.findMany({
      where,
      select: USER_SELECT,
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    prisma.users.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Cria um usuário e vincula os perfis em transação.
 *
 * @param {{ name, email, password_hash, active?, roleIds? }} data
 */
async function create({ name, email, password_hash, active = true, roleIds = [] }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password_hash,
        active,
      },
    });

    if (roleIds.length > 0) {
      await tx.user_roles.createMany({
        data: roleIds.map(role_id => ({ user_id: user.id, role_id })),
        skipDuplicates: true,
      });
    }

    // Retornar com perfis carregados
    return tx.users.findUnique({
      where: { id: user.id },
      select: USER_SELECT,
    });
  });
}

/**
 * Atualiza dados do usuário.
 * Campos não fornecidos não são alterados.
 *
 * @param {string} id
 * @param {{ name?, email?, password_hash? }} data
 */
async function update(id, data) {
  const updateData = {};
  if (data.name          !== undefined) updateData.name          = data.name;
  if (data.email         !== undefined) updateData.email         = data.email.toLowerCase().trim();
  if (data.password_hash !== undefined) updateData.password_hash = data.password_hash;

  return prisma.users.update({
    where: { id },
    data:  updateData,
    select: USER_SELECT,
  });
}

/**
 * Altera o status ativo/inativo do usuário.
 *
 * @param {string} id
 * @param {boolean} active
 */
async function setStatus(id, active) {
  return prisma.users.update({
    where: { id },
    data:  { active },
    select: USER_SELECT,
  });
}

/**
 * Substitui todos os perfis de um usuário.
 * Remove os perfis atuais e insere os novos em transação.
 *
 * @param {string} userId
 * @param {string[]} roleIds
 */
async function setRoles(userId, roleIds) {
  return prisma.$transaction(async (tx) => {
    await tx.user_roles.deleteMany({ where: { user_id: userId } });

    if (roleIds.length > 0) {
      await tx.user_roles.createMany({
        data: roleIds.map(role_id => ({ user_id: userId, role_id })),
        skipDuplicates: true,
      });
    }

    return tx.users.findUnique({
      where:  { id: userId },
      select: USER_SELECT,
    });
  });
}

module.exports = {
  findById,
  findByEmail,
  findMany,
  create,
  update,
  setStatus,
  setRoles,
};
