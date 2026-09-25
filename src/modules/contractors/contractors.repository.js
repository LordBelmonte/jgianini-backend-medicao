'use strict';

/**
 * Repository de Empreiteiros
 *
 * Referência: Documento 2 — seção 7
 *             Documento 3 — §13 (contractors), §14 (work_contractors)
 *
 * Responsabilidade: isolar operações de persistência.
 * NÃO decide regras de negócio.
 */

const prisma = require('../../config/prisma');

const CONTRACTOR_SELECT = {
  id:         true,
  name:       true,
  document:   true,
  email:      true,
  phone:      true,
  active:     true,
  created_at: true,
  updated_at: true,
};

// ─── empreiteiros ─────────────────────────────────────────────────────────────

async function findById(id) {
  return prisma.contractors.findUnique({ where: { id }, select: CONTRACTOR_SELECT });
}

async function findByDocument(document) {
  return prisma.contractors.findUnique({ where: { document }, select: CONTRACTOR_SELECT });
}

/**
 * Lista empreiteiros com filtros e paginação.
 * `contractorIds` null = sem restrição; array = filtrar por esses IDs.
 */
async function findMany({ name, document, active, contractorIds, page = 1, limit = 20 } = {}) {
  const where = {};

  if (name)     where.name     = { contains: name,     mode: 'insensitive' };
  if (document) where.document = { contains: document, mode: 'insensitive' };
  if (active !== undefined) where.active = active;

  if (contractorIds !== null && contractorIds !== undefined) {
    where.id = { in: contractorIds };
  }

  const skip = (page - 1) * limit;
  const take = limit;

  const [data, total] = await prisma.$transaction([
    prisma.contractors.findMany({ where, select: CONTRACTOR_SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.contractors.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function create({ name, document, email, phone }) {
  return prisma.contractors.create({
    data: {
      name:     name.trim(),
      document: document?.trim() || null,
      email:    email?.trim()    || null,
      phone:    phone?.trim()    || null,
      active:   true,
    },
    select: CONTRACTOR_SELECT,
  });
}

async function update(id, data) {
  const updateData = {};
  if (data.name     !== undefined) updateData.name     = data.name.trim();
  if (data.document !== undefined) updateData.document = data.document?.trim() || null;
  if (data.email    !== undefined) updateData.email    = data.email?.trim()    || null;
  if (data.phone    !== undefined) updateData.phone    = data.phone?.trim()    || null;

  return prisma.contractors.update({ where: { id }, data: updateData, select: CONTRACTOR_SELECT });
}

async function setStatus(id, active) {
  return prisma.contractors.update({ where: { id }, data: { active }, select: CONTRACTOR_SELECT });
}

// ─── obras vinculadas ao empreiteiro ──────────────────────────────────────────

/**
 * IDs dos empreiteiros ativos em um conjunto de obras.
 * Usado para filtrar a listagem por perfil Coordinator/Fiscal/Responsible.
 */
async function getContractorIdsByWorkIds(workIds) {
  if (!workIds || workIds.length === 0) return [];
  const links = await prisma.work_contractors.findMany({
    where:  { work_id: { in: workIds }, active: true },
    select: { contractor_id: true },
  });
  return [...new Set(links.map(l => l.contractor_id))];
}

/**
 * Obras ativas vinculadas a um empreiteiro.
 */
async function findWorksByContractor(contractorId) {
  const links = await prisma.work_contractors.findMany({
    where:   { contractor_id: contractorId, active: true },
    include: {
      work: {
        select: { id: true, code: true, name: true, client_name: true, address: true, status: true },
      },
    },
    orderBy: { created_at: 'asc' },
  });
  return links.map(l => l.work);
}

module.exports = {
  findById,
  findByDocument,
  findMany,
  create,
  update,
  setStatus,
  getContractorIdsByWorkIds,
  findWorksByContractor,
};
