'use strict';
const svc = require('./financial.service');

async function getByMeasurement(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.getByMeasurement(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function updateAdjustments(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.updateAdjustments(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
module.exports = { getByMeasurement, updateAdjustments };
