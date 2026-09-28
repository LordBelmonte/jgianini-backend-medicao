'use strict';
const prisma = require('../../config/prisma');

const INCLUDE = {
  reason:          { select: { id: true, code: true, description: true } },
  measurement_item: { select: { id: true, service_id: true } },
  original_al:     { select: { id: true, code: true } },
};

async function listByMeasurement(measurementId) {
  return prisma.reworks.findMany({ where: { measurement_id: measurementId }, include: INCLUDE, orderBy: { created_at: 'asc' } });
}

async function findById(id) {
  return prisma.reworks.findUnique({ where: { id }, include: INCLUDE });
}

async function create(data) {
  return prisma.reworks.create({ data, include: INCLUDE });
}

module.exports = { listByMeasurement, findById, create };
