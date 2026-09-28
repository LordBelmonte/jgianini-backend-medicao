'use strict';
const prisma = require('../../config/prisma');
const { Prisma } = require('@prisma/client');

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITÓRIO DE MEDIÇÕES — somente acesso a dados
// ─────────────────────────────────────────────────────────────────────────────

const MEAS_INCLUDE = {
  work:       { select: { id: true, code: true, name: true } },
  contractor: { select: { id: true, name: true } },
  contract:   { select: { id: true, contract_number: true, retention_percent: true } },
  creator:    { select: { id: true, name: true, email: true } },
  measurement_items: {
    include: {
      service: { select: { id: true, code: true, name: true, unit: true, requires_al: true } },
      al:      { select: { id: true, code: true } },
    },
  },
  measurement_financial: true,
};

async function list({ workId, contractorId, contractId, status, isExceptional, competenceMonth, page, limit, actor }) {
  const where = {};
  if (workId)         where.work_id       = workId;
  if (contractorId)   where.contractor_id = contractorId;
  if (contractId)     where.contract_id   = contractId;
  if (status)         where.status        = status;
  if (competenceMonth) where.competence_month = competenceMonth;
  if (isExceptional !== undefined) where.is_exceptional = isExceptional;

  const skip = ((page || 1) - 1) * (limit || 50);
  const [total, items] = await Promise.all([
    prisma.measurements.count({ where }),
    prisma.measurements.findMany({
      where,
      include: {
        work:       { select: { id: true, code: true, name: true } },
        contractor: { select: { id: true, name: true } },
        contract:   { select: { id: true, contract_number: true } },
        creator:    { select: { id: true, name: true } },
        measurement_financial: { select: { gross_amount: true, net_amount: true, financial_status: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit || 50,
    }),
  ]);
  return { items, pagination: { page: page || 1, limit: limit || 50, total, pages: Math.ceil(total / (limit || 50)) } };
}

async function findById(id) {
  return prisma.measurements.findUnique({ where: { id }, include: MEAS_INCLUDE });
}

async function create(data) {
  return prisma.measurements.create({ data, include: { work: true, contractor: true, contract: true, creator: { select: { id: true, name: true } } } });
}

async function update(id, data) {
  return prisma.measurements.update({ where: { id }, data });
}

async function addItem(data) {
  return prisma.measurement_items.create({
    data,
    include: { service: { select: { id: true, code: true, name: true, unit: true } }, al: { select: { id: true, code: true } } },
  });
}

async function updateItem(itemId, data) {
  return prisma.measurement_items.update({ where: { id: itemId }, data });
}

async function deleteItem(itemId) {
  return prisma.measurement_items.delete({ where: { id: itemId } });
}

async function findItemById(itemId) {
  return prisma.measurement_items.findUnique({
    where: { id: itemId },
    include: {
      measurement: { select: { id: true, status: true, work_id: true, contractor_id: true, is_exceptional: true } },
      service:     { select: { id: true, code: true, name: true, unit: true, requires_al: true } },
      al:          { select: { id: true, code: true, status: true, quantity: true, work_id: true } },
    },
  });
}

async function upsertFinancial(measurementId, data) {
  return prisma.measurement_financials.upsert({
    where:  { measurement_id: measurementId },
    create: { measurement_id: measurementId, ...data },
    update: data,
  });
}

async function getFinancial(measurementId) {
  return prisma.measurement_financials.findUnique({ where: { measurement_id: measurementId } });
}

async function addStatusHistory(data) {
  return prisma.measurement_status_history.create({ data });
}

/** Próximo número sequencial para a obra (Formato: NNN-WORK_CODE-CONTRACTOR-MM/YYYY) */
async function nextSequenceForWork(workId) {
  const count = await prisma.measurements.count({
    where: { work_id: workId, number: { not: null } },
  });
  return count + 1;
}

/** Saldo contratual por serviço: retorna a soma já consumida em medições aprovadas. */
async function consumedContractQtyByService(contractId, serviceId) {
  const result = await prisma.measurement_items.aggregate({
    where: {
      service_id: serviceId,
      measurement: {
        contract_id: contractId,
        status: { in: ['FISCAL_APPROVED', 'RESPONSIBLE_REVIEW', 'RESPONSIBLE_APPROVED', 'COORDINATOR_REVIEW', 'COORDINATOR_APPROVED', 'COORDINATOR_APPROVED_EXCEPTIONAL', 'DIRECTOR_REVIEW', 'APPROVED'] },
      },
    },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? new Prisma.Decimal(0);
}

module.exports = {
  list, findById, create, update,
  addItem, updateItem, deleteItem, findItemById,
  upsertFinancial, getFinancial,
  addStatusHistory, nextSequenceForWork,
  consumedContractQtyByService,
};
