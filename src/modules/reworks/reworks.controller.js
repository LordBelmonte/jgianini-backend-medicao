'use strict';
const svc = require('./reworks.service');

async function listByMeasurement(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.listByMeasurement(req.params.measurementId, req.user) }); }
  catch (e) { next(e); }
}
async function findById(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.findById(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.create(req.body, req.user) }); }
  catch (e) { next(e); }
}
async function listReasons(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.listReasons() }); }
  catch (e) { next(e); }
}
module.exports = { listByMeasurement, findById, create, listReasons };
