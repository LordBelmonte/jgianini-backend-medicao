'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITÓRIO DE PRODUÇÕES — somente acesso a dados
// ─────────────────────────────────────────────────────────────────────────────

const PROD_INCLUDE = {
  measurement_item: {
    select: {
      id: true,
      measurement_id: true,
      service_id: true,
      quantity: true,
      unit_price: true,
      measurement: {
        select: { id: true, work_id: true, contractor_id: true, contract_id: true, status: true },
      },
    },
  },
  al: {
    select: { id: true, code: true, quantity: true, status: true, work_id: true },
  },
};

async function listByMeasurementItem(measurementItemId) {
  return prisma.productions.findMany({
    where:   { measurement_item_id: measurementItemId },
    include: PROD_INCLUDE,
    orderBy: { created_at: 'asc' },
  });
}

async function listByAl(alId) {
  return prisma.productions.findMany({
    where:   { al_id: alId },
    include: PROD_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

async function findById(id) {
  return prisma.productions.findUnique({ where: { id }, include: PROD_INCLUDE });
}

async function create(data) {
  return prisma.productions.create({ data, include: PROD_INCLUDE });
}

/**
 * Soma das quantidades de produção para um measurement_item específico.
 * Usado para validar que a soma de produções não ultrapassa a quantity do item.
 */
async function totalForItem(measurementItemId) {
  const result = await prisma.productions.aggregate({
    where: { measurement_item_id: measurementItemId },
    _sum:  { quantity: true },
  });
  const { Prisma } = require('@prisma/client');
  return result._sum.quantity ?? new Prisma.Decimal(0);
}

module.exports = {
  listByMeasurementItem,
  listByAl,
  findById,
  create,
  totalForItem,
};
