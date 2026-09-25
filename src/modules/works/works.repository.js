'use strict';

/**
 * Repository de Obras
 *
 * Referência: Documento 2 — seção 7 (responsabilidades do Repository)
 *             Documento 3 — §11 (works), §12 (user_works), §14 (work_contractors)
 *
 * Responsabilidade: isolar operações de persistência.
 * NÃO decide regras de negócio.
 */

const prisma = require('../../config/prisma');

// ─── seleção segura para retorno de obra ─────────────────────────────────────
const WORK_SELECT = {
  id:          true,
  code:        true,
  name:        true,
  client_name: true,
  address:     true,
  status:      true,
  created_at:  true,
  updated_at:  true,
};

// ─── obras ───────────────────────────────────────────────────────────────────

async function findById(id) {
  return prisma.works.findUnique({
    where: { id },
    select: WORK_SELECT,
  });
}

async function findByCode(code) {
  return prisma.works.findUnique({
    where: { code },
    select: WORK_SELECT,
  });
}

/**
 * Lista obras com filtros e paginação.
 * Se `workIds` for fornecido, filtra somente essas obras (para controle de acesso por vínculo).
 */
async function findMany({ code, name, client, status, workIds, page = 1, limit = 20 } = {}) {
  const where = {};

  if (code)   where.code        = { contains: code,   mode: 'insensitive' };
  if (name)   where.name        = { contains: name,   mode: 'insensitive' };
  if (client) where.client_name = { contains: client, mode: 'insensitive' };
  if (status) where.status      = status;

  // Restrição por vínculo — null significa sem restrição (Admin/Diretor)
  if (workIds !== null && workIds !== undefined) {
    where.id = { in: workIds };
  }

  const skip = (page - 1) * limit;
  const take = limit;

  const [data, total] = await prisma.$transaction([
    prisma.works.findMany({
      where,
      select: WORK_SELECT,
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    prisma.works.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function create({ code, name, client_name, address }) {
  return prisma.works.create({
    data: { code: code.trim().toUpperCase(), name: name.trim(), client_name: client_name.trim(), address: address?.trim() || null },
    select: WORK_SELECT,
  });
}

async function update(id, data) {
  const updateData = {};
  if (data.code        !== undefined) updateData.code        = data.code.trim().toUpperCase();
  if (data.name        !== undefined) updateData.name        = data.name.trim();
  if (data.client_name !== undefined) updateData.client_name = data.client_name.trim();
  if (data.address     !== undefined) updateData.address     = data.address?.trim() || null;

  return prisma.works.update({ where: { id }, data: updateData, select: WORK_SELECT });
}

async function setStatus(id, active) {
  return prisma.works.update({
    where: { id },
    data:  { status: active ? 'ACTIVE' : 'INACTIVE' },
    select: WORK_SELECT,
  });
}

// ─── vínculo usuário↔obra ─────────────────────────────────────────────────────

/** IDs das obras vinculadas a um usuário */
async function getWorkIdsByUser(userId) {
  const links = await prisma.user_works.findMany({
    where:  { user_id: userId },
    select: { work_id: true },
  });
  return links.map(l => l.work_id);
}

/** Verifica se o vínculo usuário↔obra existe */
async function findUserWork(workId, userId) {
  return prisma.user_works.findUnique({
    where: { user_id_work_id: { user_id: userId, work_id: workId } },
  });
}

/** Lista usuários de uma obra */
async function findUsersByWork(workId) {
  const links = await prisma.user_works.findMany({
    where:  { work_id: workId },
    include: {
      user: {
        select: {
          id:         true,
          name:       true,
          email:      true,
          active:     true,
          user_roles: { include: { role: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return links.map(l => ({
    ...l.user,
    roles: l.user.user_roles.map(ur => ({ id: ur.role.id, name: ur.role.name })),
    user_roles: undefined,
  }));
}

/** Cria vínculo usuário↔obra */
async function createUserWork(workId, userId) {
  return prisma.user_works.create({
    data: { user_id: userId, work_id: workId },
  });
}

/** Remove vínculo usuário↔obra */
async function deleteUserWork(workId, userId) {
  return prisma.user_works.delete({
    where: { user_id_work_id: { user_id: userId, work_id: workId } },
  });
}

// ─── vínculo obra↔empreiteiro ─────────────────────────────────────────────────

/** Verifica vínculo obra↔empreiteiro (ativo ou inativo) */
async function findWorkContractor(workId, contractorId) {
  return prisma.work_contractors.findUnique({
    where: { work_id_contractor_id: { work_id: workId, contractor_id: contractorId } },
  });
}

/** Lista empreiteiros ativos de uma obra */
async function findContractorsByWork(workId) {
  const links = await prisma.work_contractors.findMany({
    where:   { work_id: workId, active: true },
    include: {
      contractor: {
        select: { id: true, name: true, document: true, email: true, phone: true, active: true },
      },
    },
    orderBy: { created_at: 'asc' },
  });
  return links.map(l => l.contractor);
}

/**
 * Vincula empreiteiro a obra.
 * Se já existir registro inativo → reativa (P-03 regra 8).
 * Se não existir → cria novo.
 */
async function upsertWorkContractor(workId, contractorId) {
  const existing = await findWorkContractor(workId, contractorId);

  if (existing) {
    // Reativa vínculo previamente removido
    return prisma.work_contractors.update({
      where: { work_id_contractor_id: { work_id: workId, contractor_id: contractorId } },
      data:  { active: true },
    });
  }

  return prisma.work_contractors.create({
    data: { work_id: workId, contractor_id: contractorId, active: true },
  });
}

/** Soft-delete do vínculo obra↔empreiteiro (active = false) — preserva histórico */
async function deactivateWorkContractor(workId, contractorId) {
  return prisma.work_contractors.update({
    where: { work_id_contractor_id: { work_id: workId, contractor_id: contractorId } },
    data:  { active: false },
  });
}

module.exports = {
  findById,
  findByCode,
  findMany,
  create,
  update,
  setStatus,
  getWorkIdsByUser,
  findUserWork,
  findUsersByWork,
  createUserWork,
  deleteUserWork,
  findWorkContractor,
  findContractorsByWork,
  upsertWorkContractor,
  deactivateWorkContractor,
};
