'use strict';
const svc = require('./payments.service');

async function listByMeasurement(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.listByMeasurement(req.params.measurementId, req.user) }); }
  catch (e) { next(e); }
}
async function findById(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.findById(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.create(req.params.measurementId, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function cancel(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.cancel(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
module.exports = { listByMeasurement, findById, create, cancel };
