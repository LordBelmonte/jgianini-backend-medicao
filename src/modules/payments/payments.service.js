'use strict';
const { Prisma } = require('@prisma/client');
const prisma     = require('../../config/prisma');
const repository = require('./payments.repository');
const validation = require('./payments.validation');
const measSvc    = require('../measurements/measurements.service');
const measRepo   = require('../measurements/measurements.repository');
const notifSvc   = require('../notifications/notifications.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE PAGAMENTOS
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId, action, entity_type: 'payment', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function err(msg, code, status = 400) {
  const e = new Error(msg); e.statusCode = status; e.code = code; return e;
}

async function listByMeasurement(measurementId, actor) {
  const m = await measSvc.getMeasurement(measurementId);
  await measSvc.assertMeasurementAccess(m, actor);
  return repository.listByMeasurement(measurementId);
}

async function findById(id, actor) {
  const p = await repository.findById(id);
  if (!p) throw err('Pagamento não encontrado.', 'PAYMENT_NOT_FOUND', 404);
  const m = await measSvc.getMeasurement(p.measurement.id);
  await measSvc.assertMeasurementAccess(m, actor);
  return p;
}

/**
 * Cria pagamento com controle de saldo (Doc1 §22, §56).
 * Protegido por transação para evitar concorrência (Doc2 §16).
 */
async function create(measurementId, data, actor) {
  const m = await measSvc.getMeasurement(measurementId);
  await measSvc.assertMeasurementAccess(m, actor);

  // Somente Finance/Admin/Coordinator/Director podem criar pagamentos
  const canPay = ['ADMIN', 'COORDINATOR', 'DIRECTOR', 'RESPONSIBLE'];
  if (!actor.roles.some(r => canPay.includes(r))) {
    throw err('Perfil não autorizado para registrar pagamentos.', 'FORBIDDEN', 403);
  }

  // Medição deve estar APPROVED
  if (m.status !== 'APPROVED') throw err('Somente medições aprovadas podem receber pagamentos.', 'MEASUREMENT_NOT_APPROVED', 409);

  const errors = validation.validateCreate(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  const fin = await measRepo.getFinancial(measurementId);
  if (!fin) throw err('Financeiro não calculado.', 'FINANCIAL_NOT_FOUND', 404);

  // Transação para prevenir saldo negativo por concorrência
  return prisma.$transaction(async (tx) => {
    // Recalcular saldo dentro da transação
    const paidAgg = await tx.payments.aggregate({
      where: { measurement_id: measurementId, status: { not: 'CANCELLED' } },
      _sum:  { amount: true },
    });
    const alreadyPaid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
    const netAmount   = new Prisma.Decimal(fin.net_amount);
    const newAmount   = new Prisma.Decimal(data.amount);
    const remaining   = netAmount.sub(alreadyPaid);

    // Doc1 §22 / Doc4 §56 — nunca permitir pagamento acima do saldo
    if (newAmount.gt(remaining)) {
      throw err(`Pagamento (${newAmount}) excede o saldo disponível (${remaining}).`, 'PAYMENT_EXCEEDS_BALANCE', 409);
    }

    const payment = await tx.payments.create({
      data: {
        measurement_id: measurementId,
        amount:         newAmount,
        status:         'PENDING',
        payment_date:   new Date(data.payment_date),
        created_by:     actor.id,
      },
    });

    // Atualizar financial
    const newPaid    = alreadyPaid.add(newAmount);
    const newRemain  = netAmount.sub(newPaid);
    const newStatus  = newRemain.lte(0) ? 'PAID' : 'PARTIAL';

    await tx.measurement_financials.update({
      where: { measurement_id: measurementId },
      data: {
        paid_amount:      newPaid,
        remaining_amount: newRemain.lt(0) ? new Prisma.Decimal(0) : newRemain,
        financial_status: newStatus,
      },
    });

    await tx.audit_logs.create({
      data: { user_id: actor.id, action: 'CREATE_PAYMENT', entity_type: 'payment', entity_id: payment.id, new_values: { measurement_id: measurementId, amount: newAmount, remaining: newRemain } },
    });

    // Notificar (fora da transação seria melhor, mas como é não bloqueante, ok dentro)
    notifSvc.onPaymentCreated(m, newAmount.toNumber()).catch(() => {});

    return payment;
  });
}

/**
 * Cancela pagamento — permanece no banco (Doc3 §51).
 */
async function cancel(id, data, actor) {
  const p = await findById(id, actor);

  if (p.status === 'CANCELLED') throw err('Pagamento já cancelado.', 'STATUS_UNCHANGED', 409);

  const errors = validation.validateCancel(data);
  if (errors.length > 0) throw err('Dados inválidos.', 'VALIDATION_ERROR', 400, errors);

  const canCancel = ['ADMIN', 'COORDINATOR', 'DIRECTOR'];
  if (!actor.roles.some(r => canCancel.includes(r))) {
    throw err('Perfil não autorizado para cancelar pagamentos.', 'FORBIDDEN', 403);
  }

  const cancelled = await repository.update(id, {
    status:              'CANCELLED',
    cancelled_at:        new Date(),
    cancellation_reason: data.reason.trim(),
    cancelled_by:        actor.id,
  });

  // Recalcular financial após cancelamento
  const fin = await measRepo.getFinancial(p.measurement.id);
  if (fin) {
    const paidAgg = await prisma.payments.aggregate({
      where: { measurement_id: p.measurement.id, status: { not: 'CANCELLED' } },
      _sum:  { amount: true },
    });
    const newPaid   = paidAgg._sum.amount ?? new Prisma.Decimal(0);
    const net       = new Prisma.Decimal(fin.net_amount);
    const newRemain = net.sub(newPaid);
    const newStatus = newPaid.lte(0) ? 'PENDING' : newRemain.lte(0) ? 'PAID' : 'PARTIAL';

    await measRepo.upsertFinancial(p.measurement.id, {
      ...fin,
      paid_amount:      newPaid,
      remaining_amount: newRemain.lt(0) ? new Prisma.Decimal(0) : newRemain,
      financial_status: newStatus,
    });
  }

  await audit({ actorId: actor.id, action: 'CANCEL_PAYMENT', entityId: id, oldValues: { status: 'PENDING' }, newValues: { status: 'CANCELLED', reason: data.reason } });
  return cancelled;
}

module.exports = { listByMeasurement, findById, create, cancel };
