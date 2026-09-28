'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE RELATÓRIOS (Doc4 §44, Doc5 — reports.view)
// Consultas agregadas respeitando acesso contextual.
// ─────────────────────────────────────────────────────────────────────────────

async function getAccessibleWorkIds(actor) {
  if (actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR')) return null; // null = sem filtro
  if (actor.roles.includes('CONTRACTOR')) return null; // filtrado por contractorId
  const links = await prisma.user_works.findMany({ where: { user_id: actor.id }, select: { work_id: true } });
  return links.map(l => l.work_id);
}

async function measurements({ workId, contractorId, status, competenceMonth, page = 1, limit = 100 }, actor) {
  const workIds = await getAccessibleWorkIds(actor);
  const where = {};
  if (workId) where.work_id = workId;
  else if (workIds) where.work_id = { in: workIds };
  if (actor.roles.includes('CONTRACTOR')) where.contractor_id = actor.contractor_id;
  else if (contractorId) where.contractor_id = contractorId;
  if (status)          where.status           = status;
  if (competenceMonth) where.competence_month = competenceMonth;

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.measurements.count({ where }),
    prisma.measurements.findMany({
      where,
      include: {
        work:       { select: { id: true, code: true, name: true } },
        contractor: { select: { id: true, name: true } },
        contract:   { select: { id: true, contract_number: true } },
        measurement_financial: { select: { gross_amount: true, net_amount: true, paid_amount: true, remaining_amount: true, financial_status: true } },
      },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function payments({ workId, contractorId, measurementId, status, page = 1, limit = 100 }, actor) {
  const workIds = await getAccessibleWorkIds(actor);
  const where = {};
  if (measurementId) {
    where.measurement_id = measurementId;
  } else {
    const measWhere = {};
    if (workId) measWhere.work_id = workId;
    else if (workIds) measWhere.work_id = { in: workIds };
    if (actor.roles.includes('CONTRACTOR')) measWhere.contractor_id = actor.contractor_id;
    else if (contractorId) measWhere.contractor_id = contractorId;
    where.measurement = measWhere;
  }
  if (status) where.status = status;

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.payments.count({ where }),
    prisma.payments.findMany({
      where,
      include: {
        measurement: { select: { id: true, number: true, work_id: true, contractor_id: true } },
        creator:     { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function als({ workId, contractId, status, page = 1, limit = 100 }, actor) {
  const workIds = await getAccessibleWorkIds(actor);
  const where = {};
  if (workId) where.work_id = workId;
  else if (workIds) where.work_id = { in: workIds };
  if (contractId) where.contract_id = contractId;
  if (status)     where.status      = status;
  if (actor.roles.includes('CONTRACTOR')) {
    where.OR = [
      { al_contractors: { none: {} } },
      { al_contractors: { some: { contractor_id: actor.contractor_id } } },
    ];
  }

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.als.count({ where }),
    prisma.als.findMany({
      where,
      include: { work: { select: { id: true, code: true } }, service: { select: { id: true, code: true, name: true } } },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function reworks({ workId, measurementId, page = 1, limit = 100 }, actor) {
  const workIds = await getAccessibleWorkIds(actor);
  const where = {};
  if (measurementId) {
    where.measurement_id = measurementId;
  } else {
    const measWhere = {};
    if (workId) measWhere.work_id = workId;
    else if (workIds) measWhere.work_id = { in: workIds };
    if (actor.roles.includes('CONTRACTOR')) measWhere.contractor_id = actor.contractor_id;
    where.measurement = measWhere;
  }

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.reworks.count({ where }),
    prisma.reworks.findMany({
      where,
      include: {
        reason:      { select: { id: true, code: true, description: true } },
        measurement: { select: { id: true, number: true } },
      },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function auditLogs({ userId, entityType, entityId, action, page = 1, limit = 100 }, actor) {
  // Somente Admin pode ver todos; outros veem o próprio
  const where = {};
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('DIRECTOR')) {
    where.user_id = actor.id;
  } else {
    if (userId)     where.user_id     = userId;
    if (entityType) where.entity_type = entityType;
    if (entityId)   where.entity_id   = entityId;
    if (action)     where.action      = action;
  }

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.audit_logs.count({ where }),
    prisma.audit_logs.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = { measurements, payments, als, reworks, auditLogs };
