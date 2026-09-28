'use strict';
const svc = require('./reports.service');

function qp(req) { return req.query; }

async function measurements(req, res, next) {
  try {
    const { work_id, contractor_id, status, competence_month, page, limit } = qp(req);
    const r = await svc.measurements({ workId: work_id, contractorId: contractor_id, status, competenceMonth: competence_month, page: parseInt(page||1,10), limit: parseInt(limit||100,10) }, req.user);
    res.status(200).json({ success: true, ...r });
  } catch (e) { next(e); }
}
async function payments(req, res, next) {
  try {
    const { work_id, contractor_id, measurement_id, status, page, limit } = qp(req);
    const r = await svc.payments({ workId: work_id, contractorId: contractor_id, measurementId: measurement_id, status, page: parseInt(page||1,10), limit: parseInt(limit||100,10) }, req.user);
    res.status(200).json({ success: true, ...r });
  } catch (e) { next(e); }
}
async function als(req, res, next) {
  try {
    const { work_id, contract_id, status, page, limit } = qp(req);
    const r = await svc.als({ workId: work_id, contractId: contract_id, status, page: parseInt(page||1,10), limit: parseInt(limit||100,10) }, req.user);
    res.status(200).json({ success: true, ...r });
  } catch (e) { next(e); }
}
async function reworks(req, res, next) {
  try {
    const { work_id, measurement_id, page, limit } = qp(req);
    const r = await svc.reworks({ workId: work_id, measurementId: measurement_id, page: parseInt(page||1,10), limit: parseInt(limit||100,10) }, req.user);
    res.status(200).json({ success: true, ...r });
  } catch (e) { next(e); }
}
async function auditLogs(req, res, next) {
  try {
    const { user_id, entity_type, entity_id, action, page, limit } = qp(req);
    const r = await svc.auditLogs({ userId: user_id, entityType: entity_type, entityId: entity_id, action, page: parseInt(page||1,10), limit: parseInt(limit||100,10) }, req.user);
    res.status(200).json({ success: true, ...r });
  } catch (e) { next(e); }
}
module.exports = { measurements, payments, als, reworks, auditLogs };
