'use strict';
const svc = require('./contests.service');

async function contest(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.contest(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function resolveContest(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.resolveContest(req.params.contestId, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function listByMeasurement(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.listByMeasurement(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function findById(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.findById(req.params.contestId, req.user) }); }
  catch (e) { next(e); }
}
module.exports = { contest, resolveContest, listByMeasurement, findById };
