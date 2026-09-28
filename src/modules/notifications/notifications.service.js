'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE NOTIFICAÇÕES (Doc1 §32, Doc6 §52)
// Notificações internas — não enviam e-mail ou SMS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma notificação para um usuário.
 */
async function notify(userId, type, title, message, entityType, entityId) {
  if (!userId) return; // não criar notificação sem destinatário
  return prisma.notifications.create({
    data: {
      user_id:     userId,
      type,
      title,
      message,
      entity_type: entityType || null,
      entity_id:   entityId   || null,
    },
  });
}

/**
 * Notificar múltiplos usuários (sem duplicar).
 */
async function notifyMany(userIds, type, title, message, entityType, entityId) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const uid of unique) {
    await notify(uid, type, title, message, entityType, entityId);
  }
}

/**
 * Buscar usuários de uma obra com determinados perfis.
 */
async function getUsersOfWork(workId, roleNames) {
  const roles = await prisma.roles.findMany({ where: { name: { in: roleNames } }, select: { id: true } });
  const roleIds = roles.map(r => r.id);
  const links = await prisma.user_works.findMany({
    where: {
      work_id: workId,
      user: { user_roles: { some: { role_id: { in: roleIds } } } },
    },
    select: { user_id: true },
  });
  return links.map(l => l.user_id);
}

// ─── eventos pré-definidos ───────────────────────────────────────────────────

async function onMeasurementSubmitted(measurement) {
  // Notificar Fiscais da obra
  const fiscals = await getUsersOfWork(measurement.work_id, ['FISCAL', 'COORDINATOR']);
  await notifyMany(fiscals, 'MEASUREMENT_SUBMITTED', 'Nova medição enviada',
    `Medição de ${measurement.competence_month} aguarda conferência do Fiscal.`,
    'measurement', measurement.id);
}

async function onMeasurementReturned(measurement, actorName) {
  // Notificar o criador da medição (empreiteiro)
  await notify(measurement.created_by, 'MEASUREMENT_RETURNED', 'Medição devolvida',
    `Sua medição foi devolvida pelo Fiscal ${actorName} para correção.`,
    'measurement', measurement.id);
}

async function onMeasurementApprovedFiscal(measurement) {
  const responsibles = await getUsersOfWork(measurement.work_id, ['RESPONSIBLE']);
  await notifyMany(responsibles, 'MEASUREMENT_APPROVED_FISCAL', 'Medição aprovada pelo Fiscal',
    `Medição ${measurement.number || '(sem número)'} aguarda aprovação do Responsável.`,
    'measurement', measurement.id);
}

async function onMeasurementApprovedResponsible(measurement) {
  const coords = await getUsersOfWork(measurement.work_id, ['COORDINATOR']);
  await notifyMany(coords, 'MEASUREMENT_APPROVED_RESPONSIBLE', 'Medição aprovada pelo Responsável',
    `Medição ${measurement.number || '(sem número)'} aguarda aprovação do Coordenador.`,
    'measurement', measurement.id);
}

async function onMeasurementApprovedCoordinator(measurement) {
  const directors = await getUsersOfWork(measurement.work_id, ['DIRECTOR']);
  await notifyMany(directors, 'MEASUREMENT_APPROVED_COORDINATOR', 'Medição aprovada pelo Coordenador',
    `Medição ${measurement.number || '(sem número)'} aguarda aprovação final do Diretor.`,
    'measurement', measurement.id);
}

async function onMeasurementApproved(measurement) {
  // Notificar criador (empreiteiro) e financeiro
  const toNotify = [measurement.created_by];
  await notifyMany(toNotify, 'MEASUREMENT_APPROVED', 'Medição aprovada',
    `Medição ${measurement.number || '(sem número)'} foi aprovada definitivamente.`,
    'measurement', measurement.id);
}

async function onMeasurementContested(measurement, contractorName) {
  const coords = await getUsersOfWork(measurement.work_id, ['COORDINATOR', 'FISCAL']);
  await notifyMany(coords, 'MEASUREMENT_CONTESTED', 'Medição contestada',
    `O empreiteiro ${contractorName} contestou a medição. Fluxo bloqueado.`,
    'measurement', measurement.id);
}

async function onContestResolved(measurement, resolverName) {
  await notify(measurement.created_by, 'CONTEST_RESOLVED', 'Contestação resolvida',
    `A contestação da sua medição foi resolvida por ${resolverName}. O fluxo foi retomado.`,
    'measurement', measurement.id);
}

async function onPaymentCreated(measurement, amount) {
  await notify(measurement.created_by, 'PAYMENT_REGISTERED', 'Pagamento registrado',
    `Um pagamento de R$ ${amount} foi registrado para sua medição ${measurement.number || ''}.`,
    'measurement', measurement.id);
}

// ─── operações de consulta ───────────────────────────────────────────────────

async function list(actor, { page = 1, limit = 50, unreadOnly = false } = {}) {
  const where = { user_id: actor.id };
  if (unreadOnly) where.read_at = null;
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.notifications.count({ where }),
    prisma.notifications.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: limit }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function markRead(id, actor) {
  const n = await prisma.notifications.findUnique({ where: { id } });
  if (!n) { const e = new Error('Notificação não encontrada.'); e.statusCode = 404; e.code = 'NOT_FOUND'; throw e; }
  if (n.user_id !== actor.id) { const e = new Error('Acesso negado.'); e.statusCode = 403; e.code = 'FORBIDDEN'; throw e; }
  return prisma.notifications.update({ where: { id }, data: { read_at: new Date() } });
}

async function markAllRead(actor) {
  return prisma.notifications.updateMany({
    where: { user_id: actor.id, read_at: null },
    data:  { read_at: new Date() },
  });
}

module.exports = {
  notify, notifyMany,
  onMeasurementSubmitted, onMeasurementReturned,
  onMeasurementApprovedFiscal, onMeasurementApprovedResponsible,
  onMeasurementApprovedCoordinator, onMeasurementApproved,
  onMeasurementContested, onContestResolved, onPaymentCreated,
  list, markRead, markAllRead,
};
