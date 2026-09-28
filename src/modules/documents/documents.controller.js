'use strict';
const svc = require('./documents.service');

async function list(req, res, next) {
  try {
    const { entity_type, entity_id, active_only, page, limit } = req.query;
    const result = await svc.list({ entityType: entity_type, entityId: entity_id, activeOnly: active_only !== 'false', page: parseInt(page||1,10), limit: parseInt(limit||50,10) }, req.user);
    res.status(200).json({ success: true, ...result });
  } catch (e) { next(e); }
}
async function findById(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.findById(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function upload(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.upload(req.body, req.user) }); }
  catch (e) { next(e); }
}
async function replace(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.replace(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
module.exports = { list, findById, upload, replace };
