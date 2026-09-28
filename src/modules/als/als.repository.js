'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITÓRIO DE ALs — somente acesso a dados
// ─────────────────────────────────────────────────────────────────────────────

const AL_INCLUDE = {
  work:     { select: { id: true, code: true, name: true } },
  contract: { select: { id: true, contract_number: true } },
  service:  { select: { id: true, code: true, name: true, unit: true } },
  importer: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
  al_contractors: {
    include: { contractor: { select: { id: true, name: true } } },
  },
};

async function list({ workId, contractId, serviceId, contractorId, status, page, limit }) {
  const skip  = (page - 1) * limit;
  const where = {};
  if (workId)       where.work_id       = workId;
  if (contractId)   where.contract_id   = contractId;
  if (serviceId)    where.service_id    = serviceId;
  if (status)       where.status        = status;
  if (contractorId) {
    where.al_contractors = { some: { contractor_id: contractorId } };
  }

  const [total, items] = await Promise.all([
    prisma.als.count({ where }),
    prisma.als.findMany({ where, include: AL_INCLUDE, orderBy: { created_at: 'desc' }, skip, take: limit }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function findById(id) {
  return prisma.als.findUnique({ where: { id }, include: AL_INCLUDE });
}

async function create(data) {
  return prisma.als.create({ data, include: AL_INCLUDE });
}

async function update(id, data) {
  return prisma.als.update({ where: { id }, data, include: AL_INCLUDE });
}

/** Retorna soma das produções válidas (medições não canceladas) que consomem esta AL. */
async function consumedQuantity(alId) {
  // Somente produções vinculadas a measurement_items de medições não-canceladas
  const result = await prisma.productions.aggregate({
    where: {
      al_id: alId,
      measurement_item: {
        measurement: { status: { not: 'CANCELLED' } },
      },
    },
    _sum: { quantity: true },
  });
  const { Prisma } = require('@prisma/client');
  return result._sum.quantity ?? new Prisma.Decimal(0);
}

async function linkContractor(alId, contractorId) {
  return prisma.al_contractors.create({ data: { al_id: alId, contractor_id: contractorId } });
}

async function unlinkContractor(alId, contractorId) {
  return prisma.al_contractors.delete({ where: { al_id_contractor_id: { al_id: alId, contractor_id: contractorId } } });
}

async function hasContractorLink(alId, contractorId) {
  const link = await prisma.al_contractors.findUnique({
    where: { al_id_contractor_id: { al_id: alId, contractor_id: contractorId } },
  });
  return !!link;
}

async function hasAnyContractorRestriction(alId) {
  const count = await prisma.al_contractors.count({ where: { al_id: alId } });
  return count > 0;
}

module.exports = {
  list,
  findById,
  create,
  update,
  consumedQuantity,
  linkContractor,
  unlinkContractor,
  hasContractorLink,
  hasAnyContractorRestriction,
};
