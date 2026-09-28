'use strict';
const prisma  = require('../../config/prisma');
const measurementsService = require('../measurements/measurements.service');
const measurementsRepo    = require('../measurements/measurements.repository');
const notifSvc            = require('../notifications/notifications.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE APROVAÇÕES
// Implementa o fluxo completo: normal e excepcional
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId, action, entity_type: 'measurement', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function err(msg, code, status = 400) {
  const e = new Error(msg); e.statusCode = status; e.code = code; return e;
}

async function recordApproval(measurementId, stage, action, actorId, reason, observation) {
  return prisma.approvals.create({
    data: { measurement_id: measurementId, stage, action, user_id: actorId, reason: reason || null, observation: observation || null },
  });
}

// ─── FLUXO NORMAL ─────────────────────────────────────────────────────────

/**
 * FISCAL aprova → FISCAL_APPROVED → número gerado → RESPONSIBLE_REVIEW
 */
async function approveFiscal(id, data, actor) {
  const m = await measurementsService.getMeasurement(id);
  await measurementsService.assertMeasurementAccess(m, actor);

  if (m.status !== 'FISCAL_REVIEW') throw err(`Transição inválida: ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  if (!actor.roles.includes('FISCAL') && !actor.roles.includes('ADMIN') && !actor.roles.includes('COORDINATOR')) {
    throw err('Perfil não autorizado a aprovar como Fiscal.', 'FORBIDDEN', 403);
  }

  // Gerar número oficial
  const fullMeasurement = await measurementsRepo.findById(id);
  const number = await measurementsService.generateNumber(fullMeasurement);

  // Recalcular financeiro antes de aprovar
  const retPct = await measurementsService.getRetentionPercent(m.contract_id, null);
  await measurementsService.recalcFinancial(id, retPct, 0, 0);

  await measurementsRepo.update(id, { status: 'FISCAL_APPROVED', number });
  await measurementsService.recordHistory(id, m.status, 'FISCAL_APPROVED', 'APPROVE_FISCAL', actor.id, null, data?.observation || null);
  await recordApproval(id, 'FISCAL', 'APPROVE', actor.id, null, data?.observation || null);
  await audit({ actorId: actor.id, action: 'APPROVE_FISCAL', entityId: id, oldValues: { status: m.status }, newValues: { status: 'FISCAL_APPROVED', number } });

  // Avançar para RESPONSIBLE_REVIEW
  await measurementsRepo.update(id, { status: 'RESPONSIBLE_REVIEW' });
  await measurementsService.recordHistory(id, 'FISCAL_APPROVED', 'RESPONSIBLE_REVIEW', 'AUTO_ADVANCE', actor.id, null, null);

  const result = await measurementsRepo.findById(id);
  notifSvc.onMeasurementApprovedFiscal(result).catch(() => {});
  return result;
}

/**
 * RESPONSIBLE aprova → COORDINATOR_REVIEW
 */
async function approveResponsible(id, data, actor) {
  const m = await measurementsService.getMeasurement(id);
  await measurementsService.assertMeasurementAccess(m, actor);

  if (m.status !== 'RESPONSIBLE_REVIEW') throw err(`Transição inválida: ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  if (!actor.roles.includes('RESPONSIBLE') && !actor.roles.includes('ADMIN') && !actor.roles.includes('COORDINATOR')) {
    throw err('Perfil não autorizado a aprovar como Responsável.', 'FORBIDDEN', 403);
  }

  await measurementsRepo.update(id, { status: 'COORDINATOR_REVIEW' });
  await measurementsService.recordHistory(id, m.status, 'COORDINATOR_REVIEW', 'APPROVE_RESPONSIBLE', actor.id, null, data?.observation || null);
  await recordApproval(id, 'RESPONSIBLE', 'APPROVE', actor.id, null, data?.observation || null);
  await audit({ actorId: actor.id, action: 'APPROVE_RESPONSIBLE', entityId: id, oldValues: { status: m.status }, newValues: { status: 'COORDINATOR_REVIEW' } });

  const result = await measurementsRepo.findById(id);
  notifSvc.onMeasurementApprovedResponsible(result).catch(() => {});
  return result;
}

/**
 * COORDINATOR aprova → DIRECTOR_REVIEW
 * Também é usado para aprovar medição excepcional (COORDINATOR_REVIEW → COORDINATOR_APPROVED_EXCEPTIONAL → DIRECTOR_REVIEW)
 */
async function approveCoordinator(id, data, actor) {
  const m = await measurementsService.getMeasurement(id);
  await measurementsService.assertMeasurementAccess(m, actor);

  const validStatuses = ['COORDINATOR_REVIEW'];
  if (!validStatuses.includes(m.status)) throw err(`Transição inválida: ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  if (!actor.roles.includes('COORDINATOR') && !actor.roles.includes('ADMIN')) {
    throw err('Perfil não autorizado a aprovar como Coordenador.', 'FORBIDDEN', 403);
  }

  let nextStatus = 'DIRECTOR_REVIEW';
  let auditAction = 'APPROVE_COORDINATOR';

  // Medição excepcional: número gerado aqui
  if (m.is_exceptional) {
    const fullMeasurement = await measurementsRepo.findById(id);
    if (!fullMeasurement.number) {
      const number = await measurementsService.generateNumber(fullMeasurement);
      await measurementsRepo.update(id, { number });
    }
    nextStatus  = 'DIRECTOR_REVIEW';
    auditAction = 'APPROVE_COORDINATOR_EXCEPTIONAL';
  }

  await measurementsRepo.update(id, { status: nextStatus });
  await measurementsService.recordHistory(id, m.status, nextStatus, auditAction, actor.id, null, data?.observation || null);
  await recordApproval(id, 'COORDINATOR', 'APPROVE', actor.id, null, data?.observation || null);
  await audit({ actorId: actor.id, action: auditAction, entityId: id, oldValues: { status: m.status }, newValues: { status: nextStatus } });

  const result = await measurementsRepo.findById(id);
  notifSvc.onMeasurementApprovedCoordinator(result).catch(() => {});
  return result;
}

/**
 * DIRECTOR aprova → APPROVED (final)
 */
async function approveDirector(id, data, actor) {
  const m = await measurementsService.getMeasurement(id);
  await measurementsService.assertMeasurementAccess(m, actor);

  if (m.status !== 'DIRECTOR_REVIEW') throw err(`Transição inválida: ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  if (!actor.roles.includes('DIRECTOR') && !actor.roles.includes('ADMIN')) {
    throw err('Perfil não autorizado a aprovar como Diretor.', 'FORBIDDEN', 403);
  }

  await measurementsRepo.update(id, { status: 'APPROVED', approved_at: new Date() });
  await measurementsService.recordHistory(id, m.status, 'APPROVED', 'APPROVE_DIRECTOR', actor.id, null, data?.observation || null);
  await recordApproval(id, 'DIRECTOR', 'APPROVE', actor.id, null, data?.observation || null);
  await audit({ actorId: actor.id, action: 'APPROVE_DIRECTOR', entityId: id, oldValues: { status: m.status }, newValues: { status: 'APPROVED' } });

  const result = await measurementsRepo.findById(id);
  notifSvc.onMeasurementApproved(result).catch(() => {});
  return result;
}

/**
 * DIRECTOR devolve ao COORDINATOR → COORDINATOR_REVIEW
 */
async function returnDirector(id, data, actor) {
  const m = await measurementsService.getMeasurement(id);
  await measurementsService.assertMeasurementAccess(m, actor);

  if (m.status !== 'DIRECTOR_REVIEW') throw err(`Transição inválida: ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  if (!actor.roles.includes('DIRECTOR') && !actor.roles.includes('ADMIN')) {
    throw err('Perfil não autorizado.', 'FORBIDDEN', 403);
  }

  if (!data?.reason || data.reason.trim() === '') throw err('Motivo de devolução obrigatório.', 'REASON_REQUIRED');

  await measurementsRepo.update(id, { status: 'COORDINATOR_REVIEW' });
  await measurementsService.recordHistory(id, m.status, 'COORDINATOR_REVIEW', 'RETURN_DIRECTOR', actor.id, data.reason, data?.observation || null);
  await recordApproval(id, 'DIRECTOR', 'RETURN', actor.id, data.reason, data?.observation || null);
  await audit({ actorId: actor.id, action: 'RETURN_DIRECTOR', entityId: id, oldValues: { status: m.status }, newValues: { status: 'COORDINATOR_REVIEW', reason: data.reason } });

  return measurementsRepo.findById(id);
}

async function listApprovals(measurementId, actor) {
  const m = await measurementsService.getMeasurement(measurementId);
  await measurementsService.assertMeasurementAccess(m, actor);
  return prisma.approvals.findMany({
    where:   { measurement_id: measurementId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { created_at: 'asc' },
  });
}

module.exports = { approveFiscal, approveResponsible, approveCoordinator, approveDirector, returnDirector, listApprovals };
