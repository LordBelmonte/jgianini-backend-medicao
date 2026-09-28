'use strict';
const prisma = require('../../config/prisma');

const INCLUDE = {
  measurement: { select: { id: true, number: true, work_id: true, contractor_id: true, status: true } },
  creator:     { select: { id: true, name: true } },
  canceller:   { select: { id: true, name: true } },
};

async function listByMeasurement(measurementId) {
  return prisma.payments.findMany({ where: { measurement_id: measurementId }, include: INCLUDE, orderBy: { created_at: 'asc' } });
}

async function findById(id) {
  return prisma.payments.findUnique({ where: { id }, include: INCLUDE });
}

async function create(data) {
  return prisma.payments.create({ data, include: INCLUDE });
}

async function update(id, data) {
  return prisma.payments.update({ where: { id }, data, include: INCLUDE });
}

/** Soma dos pagamentos válidos (não cancelados) para a medição. */
async function paidAmount(measurementId) {
  const { Prisma } = require('@prisma/client');
  const result = await prisma.payments.aggregate({
    where: { measurement_id: measurementId, status: { not: 'CANCELLED' } },
    _sum:  { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

module.exports = { listByMeasurement, findById, create, update, paidAmount };
