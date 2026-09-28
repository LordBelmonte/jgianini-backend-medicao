'use strict';
const { Prisma } = require('@prisma/client');
const prisma     = require('../../config/prisma');
const measSvc    = require('../measurements/measurements.service');
const measRepo   = require('../measurements/measurements.repository');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE FINANCEIRO — consulta e atualização do resumo financeiro
// ─────────────────────────────────────────────────────────────────────────────

function err(msg, code, status = 400) {
  const e = new Error(msg); e.statusCode = status; e.code = code; return e;
}

async function getByMeasurement(measurementId, actor) {
  const m = await measSvc.getMeasurement(measurementId);
  await measSvc.assertMeasurementAccess(m, actor);

  const fin = await measRepo.getFinancial(measurementId);
  if (!fin) throw err('Financeiro não calculado ainda.', 'FINANCIAL_NOT_FOUND', 404);
  return fin;
}

/**
 * Atualiza adiantamento e desconto manualmente (Doc1 §21).
 * Somente em medições que permitam essa operação.
 * Recalcula automaticamente net_amount e remaining_amount.
 */
async function updateAdjustments(measurementId, data, actor) {
  const m = await measSvc.getMeasurement(measurementId);
  await measSvc.assertMeasurementAccess(m, actor);

  // Somente Coordinator, Director, Admin podem ajustar adiantamento/desconto
  const canAdjust = ['COORDINATOR', 'DIRECTOR', 'ADMIN'];
  if (!actor.roles.some(r => canAdjust.includes(r))) {
    throw err('Perfil não autorizado para ajustes financeiros.', 'FORBIDDEN', 403);
  }

  const fin = await measRepo.getFinancial(measurementId);
  if (!fin) throw err('Financeiro não calculado ainda.', 'FINANCIAL_NOT_FOUND', 404);

  const advance  = data.advance_amount  !== undefined ? new Prisma.Decimal(data.advance_amount)  : new Prisma.Decimal(fin.advance_amount);
  const discount = data.discount_amount !== undefined ? new Prisma.Decimal(data.discount_amount) : new Prisma.Decimal(fin.discount_amount);

  if (advance.lt(0))  throw err('Adiantamento não pode ser negativo.', 'INVALID_VALUE');
  if (discount.lt(0)) throw err('Desconto não pode ser negativo.', 'INVALID_VALUE');

  const gross  = new Prisma.Decimal(fin.gross_amount);
  const retAmt = new Prisma.Decimal(fin.retention_amount);
  let   net    = gross.sub(retAmt).sub(advance).sub(discount);
  if (net.lt(0)) net = new Prisma.Decimal(0);

  const paid = new Prisma.Decimal(fin.paid_amount);
  let   remaining = net.sub(paid);
  if (remaining.lt(0)) remaining = new Prisma.Decimal(0);

  let status = 'PENDING';
  if (paid.gt(0) && remaining.gt(0)) status = 'PARTIAL';
  else if (paid.gt(0) && remaining.lte(0)) status = 'PAID';

  // Verificar que advance + discount não ultrapassa o disponível (Doc1 §21)
  if (advance.add(discount).gt(gross.sub(retAmt))) {
    throw err('Adiantamento + Desconto não pode ultrapassar o valor disponível da medição.', 'ADJUSTMENT_EXCEEDS_BALANCE', 409);
  }

  const updated = await measRepo.upsertFinancial(measurementId, {
    gross_amount:      gross,
    retention_percent: fin.retention_percent,
    retention_amount:  retAmt,
    advance_amount:    advance,
    discount_amount:   discount,
    net_amount:        net,
    paid_amount:       paid,
    remaining_amount:  remaining,
    financial_status:  status,
  });

  await prisma.audit_logs.create({
    data: { user_id: actor.id, action: 'UPDATE_FINANCIAL', entity_type: 'measurement', entity_id: measurementId, old_values: { advance_amount: fin.advance_amount, discount_amount: fin.discount_amount }, new_values: { advance_amount: advance, discount_amount: discount } },
  });

  return updated;
}

module.exports = { getByMeasurement, updateAdjustments };
