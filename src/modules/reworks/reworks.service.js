'use strict';
const { Prisma }  = require('@prisma/client');
const prisma      = require('../../config/prisma');
const repository  = require('./reworks.repository');
const validation  = require('./reworks.validation');
const measurementsService = require('../measurements/measurements.service');

async function audit({ actorId, action, entityId, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId, action, entity_type: 'rework', entity_id: entityId, new_values: newValues || null, old_values: null },
  });
}

function err(msg, code, status = 400, details) {
  const e = new Error(msg); e.statusCode = status; e.code = code; if (details) e.details = details; return e;
}

async function listByMeasurement(measurementId, actor) {
  const m = await measurementsService.getMeasurement(measurementId);
  await measurementsService.assertMeasurementAccess(m, actor);
  return repository.listByMeasurement(measurementId);
}

async function findById(id, actor) {
  const rw = await repository.findById(id);
  if (!rw) throw err('Retrabalho não encontrado.', 'REWORK_NOT_FOUND', 404);
  const m = await measurementsService.getMeasurement(rw.measurement_id);
  await measurementsService.assertMeasurementAccess(m, actor);
  return rw;
}

async function create(data, actor) {
  const errors = validation.validateCreate(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  const m = await measurementsService.getMeasurement(data.measurement_id);
  await measurementsService.assertMeasurementAccess(m, actor);

  // Medição deve estar em estado editável
  const editableStatuses = ['DRAFT', 'RETURNED_TO_CONTRACTOR', 'DRAFT_EXCEPTIONAL'];
  if (!editableStatuses.includes(m.status)) throw err(`Medição não editável no status ${m.status}.`, 'MEASUREMENT_NOT_EDITABLE', 403);

  // Verificar reason_id
  const reason = await prisma.rework_reasons.findUnique({ where: { id: data.reason_id } });
  if (!reason || !reason.active) throw err('Motivo de retrabalho não encontrado ou inativo.', 'REASON_NOT_FOUND', 404);

  // Verificar measurement_item_id se informado
  if (data.measurement_item_id) {
    const item = await prisma.measurement_items.findUnique({ where: { id: data.measurement_item_id } });
    if (!item || item.measurement_id !== data.measurement_id) throw err('Item de medição não encontrado.', 'ITEM_NOT_FOUND', 404);
  }

  // Verificar AL original se informada (não consome saldo — Doc7 §34)
  if (data.original_al_id) {
    const al = await prisma.als.findUnique({ where: { id: data.original_al_id } });
    if (!al) throw err('AL original não encontrada.', 'AL_NOT_FOUND', 404);
  }

  const qty   = new Prisma.Decimal(data.quantity);
  const up    = new Prisma.Decimal(data.unit_price);
  const total = qty.mul(up);

  const rework = await repository.create({
    measurement_id:      data.measurement_id,
    measurement_item_id: data.measurement_item_id || null,
    original_al_id:      data.original_al_id      || null,
    reason_id:           data.reason_id,
    quantity:            qty,
    unit_price:          up,
    total_value:         total,
    description:         data.description || null,
  });

  // Recalcular financeiro (retrabalho entra no gross_amount)
  const retPct = await measurementsService.getRetentionPercent(m.contract_id, null);
  await measurementsService.recalcFinancial(data.measurement_id, retPct, 0, 0);

  await audit({ actorId: actor.id, action: 'CREATE_REWORK', entityId: rework.id, newValues: { measurement_id: data.measurement_id, quantity: data.quantity } });
  return rework;
}

async function listReasons() {
  return prisma.rework_reasons.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
}

module.exports = { listByMeasurement, findById, create, listReasons };
