'use strict';
const prisma  = require('../../config/prisma');
const measurementsService = require('../measurements/measurements.service');
const measurementsRepo    = require('../measurements/measurements.repository');
const notifSvc            = require('../notifications/notifications.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE CONTESTAÇÃO (Doc6 §13-§16, Doc2 §23)
// ─────────────────────────────────────────────────────────────────────────────

async function audit({ actorId, action, entityId, oldValues, newValues }) {
  await prisma.audit_logs.create({
    data: { user_id: actorId, action, entity_type: 'contest', entity_id: entityId, old_values: oldValues || null, new_values: newValues || null },
  });
}

function err(msg, code, status = 400) {
  const e = new Error(msg); e.statusCode = status; e.code = code; return e;
}

/**
 * Empreiteiro abre contestação.
 * Bloqueia o fluxo → status FLOW_BLOCKED.
 */
async function contest(measurementId, data, actor) {
  if (!actor.roles.includes('CONTRACTOR') && !actor.roles.includes('ADMIN')) {
    throw err('Somente Empreiteiro pode contestar uma medição.', 'FORBIDDEN', 403);
  }
  if (!data.reason || data.reason.trim() === '') throw err('Motivo da contestação é obrigatório.', 'REASON_REQUIRED');

  const m = await measurementsService.getMeasurement(measurementId);
  await measurementsService.assertMeasurementAccess(m, actor);

  // Verificar se já existe contestação aberta (check de duplicata antes do status)
  const existing = await prisma.contests.findFirst({ where: { measurement_id: measurementId, status: 'OPEN' } });
  if (existing) throw err('Já existe uma contestação aberta para esta medição.', 'CONTEST_ALREADY_OPEN', 409);

  // Contestação somente em FISCAL_REVIEW (durante análise do Fiscal)
  if (m.status !== 'FISCAL_REVIEW') throw err(`Contestação não permitida no status ${m.status}.`, 'INVALID_STATUS_TRANSITION');

  const contest = await prisma.contests.create({
    data: {
      measurement_id: measurementId,
      created_by:     actor.id,
      reason:         data.reason.trim(),
      description:    data.description || null,
      status:         'OPEN',
    },
  });

  // Bloquear fluxo
  const old = m.status;
  await measurementsRepo.update(measurementId, { status: 'FLOW_BLOCKED' });
  await measurementsService.recordHistory(measurementId, old, 'FLOW_BLOCKED', 'CONTEST', actor.id, data.reason, null);
  await audit({ actorId: actor.id, action: 'CONTEST_MEASUREMENT', entityId: contest.id, oldValues: { status: old }, newValues: { status: 'FLOW_BLOCKED', contest_id: contest.id } });

  // Notificar coordenadores e fiscais (não bloqueante)
  const m2 = await measurementsRepo.findById(measurementId);
  notifSvc.onMeasurementContested(m2, actor.name || 'Empreiteiro').catch(() => {});

  return contest;
}

/**
 * Resolve contestação — desbloqueio do fluxo.
 * Autorizado: COORDINATOR, ADMIN (Doc4 §32)
 */
async function resolveContest(contestId, data, actor) {
  if (!actor.roles.includes('COORDINATOR') && !actor.roles.includes('ADMIN')) {
    throw err('Somente Coordenador pode resolver contestações.', 'FORBIDDEN', 403);
  }
  if (!data.resolution || data.resolution.trim() === '') throw err('Resolução é obrigatória.', 'RESOLUTION_REQUIRED');

  const contest = await prisma.contests.findUnique({
    where:   { id: contestId },
    include: { measurement: { select: { id: true, status: true, work_id: true, contractor_id: true } } },
  });
  if (!contest) throw err('Contestação não encontrada.', 'CONTEST_NOT_FOUND', 404);
  if (contest.status !== 'OPEN') throw err('Contestação já resolvida.', 'CONTEST_ALREADY_RESOLVED', 409);

  const m = contest.measurement;
  if (m.status !== 'FLOW_BLOCKED') throw err('Medição não está bloqueada.', 'MEASUREMENT_NOT_BLOCKED', 400);

  // Verificar acesso à obra
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('DIRECTOR')) {
    const link = await prisma.user_works.findFirst({ where: { user_id: actor.id, work_id: m.work_id } });
    if (!link) throw err('Usuário não está vinculado a esta obra.', 'FORBIDDEN', 403);
  }

  // Marcar contestação como resolvida
  const resolved = await prisma.contests.update({
    where: { id: contestId },
    data: {
      status:      'RESOLVED',
      resolved_by: actor.id,
      resolution:  data.resolution.trim(),
      resolved_at: new Date(),
    },
  });

  // Retornar medição para FISCAL_REVIEW (fluxo continua do ponto onde estava)
  await measurementsRepo.update(m.id, { status: 'FISCAL_REVIEW' });
  await measurementsService.recordHistory(m.id, 'FLOW_BLOCKED', 'FISCAL_REVIEW', 'RESOLVE_CONTEST', actor.id, null, data.resolution);
  await audit({ actorId: actor.id, action: 'RESOLVE_CONTEST', entityId: contestId, oldValues: { status: 'OPEN' }, newValues: { status: 'RESOLVED', resolution: data.resolution } });

  // Notificar o empreiteiro (não bloqueante)
  const m2 = await measurementsRepo.findById(m.id);
  notifSvc.onContestResolved(m2, actor.name || 'Coordenador').catch(() => {});

  return resolved;
}

async function listByMeasurement(measurementId, actor) {
  const m = await measurementsService.getMeasurement(measurementId);
  await measurementsService.assertMeasurementAccess(m, actor);
  return prisma.contests.findMany({
    where:   { measurement_id: measurementId },
    include: {
      creator:  { select: { id: true, name: true } },
      resolver: { select: { id: true, name: true } },
    },
    orderBy: { created_at: 'desc' },
  });
}

async function findById(id, actor) {
  const contest = await prisma.contests.findUnique({
    where:   { id },
    include: {
      measurement: { select: { id: true, work_id: true, contractor_id: true, status: true } },
      creator:     { select: { id: true, name: true } },
      resolver:    { select: { id: true, name: true } },
    },
  });
  if (!contest) throw err('Contestação não encontrada.', 'CONTEST_NOT_FOUND', 404);

  const m = await measurementsService.getMeasurement(contest.measurement.id);
  await measurementsService.assertMeasurementAccess(m, actor);
  return contest;
}

module.exports = { contest, resolveContest, listByMeasurement, findById };
