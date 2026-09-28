'use strict';
const { Prisma }   = require('@prisma/client');
const prisma       = require('../../config/prisma');
const repository   = require('./productions.repository');
const validation   = require('./productions.validation');
const alService    = require('../als/als.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE PRODUÇÃO — todas as regras de negócio
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId || null, action, entity_type: 'production', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function notFound(msg, code = 'NOT_FOUND') {
  const e = new Error(msg); e.statusCode = 404; e.code = code; return e;
}
function forbidden(msg, code = 'FORBIDDEN') {
  const e = new Error(msg); e.statusCode = 403; e.code = code; return e;
}
function badRequest(msg, code, details) {
  const e = new Error(msg); e.statusCode = 400; e.code = code; if (details) e.details = details; return e;
}
function conflict(msg, code = 'CONFLICT') {
  const e = new Error(msg); e.statusCode = 409; e.code = code; return e;
}

/** Verifica acesso do actor ao contexto da medição (obra). */
async function assertMeasurementAccess(measurement, actor) {
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) return;
  if (actor.roles.includes('CONTRACTOR')) {
    if (measurement.contractor_id !== actor.contractor_id) throw forbidden('Acesso negado a esta medição.');
    return;
  }
  const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: measurement.work_id } });
  if (!link) throw forbidden('Usuário não está vinculado a esta obra.');
}

/** Busca measurement_item e valida existência. */
async function getMeasurementItem(measurementItemId) {
  const item = await prisma.measurement_items.findUnique({
    where:   { id: measurementItemId },
    include: {
      measurement: {
        select: { id: true, work_id: true, contractor_id: true, contract_id: true, status: true },
      },
      service: { select: { id: true, requires_al: true } },
    },
  });
  if (!item) throw notFound('Item de medição não encontrado.', 'MEASUREMENT_ITEM_NOT_FOUND');
  return item;
}

// ─── operações públicas ──────────────────────────────────────────────────────

/**
 * Lista produções de um item de medição.
 */
async function listByItem(measurementItemId, actor) {
  const item = await getMeasurementItem(measurementItemId);
  await assertMeasurementAccess(item.measurement, actor);
  return repository.listByMeasurementItem(measurementItemId);
}

/**
 * Lista produções de uma AL.
 */
async function listByAl(alId, actor) {
  const al = await prisma.als.findUnique({ where: { id: alId } });
  if (!al) throw notFound('AL não encontrada.', 'AL_NOT_FOUND');
  return repository.listByAl(alId);
}

/**
 * Busca produção por ID.
 */
async function findById(id, actor) {
  const prod = await repository.findById(id);
  if (!prod) throw notFound('Produção não encontrada.', 'PRODUCTION_NOT_FOUND');
  await assertMeasurementAccess(prod.measurement_item.measurement, actor);
  return prod;
}

/**
 * Registra produção normal vinculada a AL.
 *
 * Regras (Doc3 §24, Doc1 §6, Doc2 §26):
 * - measurement_item deve existir e pertencer a uma medição editável (DRAFT ou RETURNED_TO_CONTRACTOR)
 * - al_id deve ser APPROVED e pertencer à mesma obra
 * - saldo da AL deve ser suficiente (AL_BALANCE_EXCEEDED se não)
 * - quantidade de produções do item não pode ultrapassar a quantity do item
 * - registrar auditoria
 */
async function create(data, actor) {
  const errors = validation.validateCreate(data);
  if (errors.length > 0) throw badRequest('Dados inválidos.', 'VALIDATION_ERROR', errors);

  // Buscar item e medição
  const item = await getMeasurementItem(data.measurement_item_id);
  await assertMeasurementAccess(item.measurement, actor);

  // Medição deve estar em estado editável
  const editableStatuses = ['DRAFT', 'RETURNED_TO_CONTRACTOR', 'DRAFT_EXCEPTIONAL'];
  if (!editableStatuses.includes(item.measurement.status)) {
    throw forbidden(
      `Produção só pode ser registrada em medições editáveis. Status atual: ${item.measurement.status}`,
      'MEASUREMENT_NOT_EDITABLE'
    );
  }

  // Buscar AL
  const al = await prisma.als.findUnique({ where: { id: data.al_id } });
  if (!al) throw notFound('AL não encontrada.', 'AL_NOT_FOUND');

  // AL deve estar APPROVED
  if (al.status !== 'APPROVED') {
    throw conflict(`AL deve estar APPROVED para registrar produção. Status atual: ${al.status}`, 'AL_NOT_APPROVED');
  }

  // AL deve pertencer à mesma obra da medição
  if (al.work_id !== item.measurement.work_id) {
    throw badRequest('AL não pertence à mesma obra da medição.', 'AL_WORK_MISMATCH');
  }

  const requested = new Prisma.Decimal(data.quantity);

  // Verificar saldo da AL (Doc1 §6 — saldo calculado pelo backend)
  await alService.assertBalanceAvailable(data.al_id, requested);

  // Verificar que soma de produções do item não ultrapassa quantity do item
  const alreadyProduced = await repository.totalForItem(data.measurement_item_id);
  const itemQty         = new Prisma.Decimal(item.quantity);
  const newTotal        = alreadyProduced.add(requested);
  if (newTotal.gt(itemQty)) {
    throw conflict(
      `Quantidade de produção (${newTotal}) ultrapassa a quantidade do item (${itemQty}).`,
      'PRODUCTION_EXCEEDS_ITEM_QUANTITY'
    );
  }

  const prod = await repository.create({
    measurement_item_id: data.measurement_item_id,
    al_id:               data.al_id,
    quantity:            data.quantity,
  });

  await audit({
    actorId:   actor.id,
    action:    'CREATE_PRODUCTION',
    entityId:  prod.id,
    newValues: { measurement_item_id: data.measurement_item_id, al_id: data.al_id, quantity: data.quantity },
  });

  return prod;
}

/**
 * Retorna o total de produção registrada para um item de medição.
 * Usado pelo módulo de Medições para validar saldo no envio.
 */
async function totalForItem(measurementItemId) {
  return repository.totalForItem(measurementItemId);
}

module.exports = {
  listByItem,
  listByAl,
  findById,
  create,
  totalForItem,
};
