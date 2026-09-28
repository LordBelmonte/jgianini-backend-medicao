'use strict';
const svc = require('./productions.service');

async function listByItem(req, res, next) {
  try {
    const items = await svc.listByItem(req.params.measurementItemId, req.user);
    res.status(200).json({ success: true, data: items });
  } catch (e) { next(e); }
}

async function listByAl(req, res, next) {
  try {
    const items = await svc.listByAl(req.params.alId, req.user);
    res.status(200).json({ success: true, data: items });
  } catch (e) { next(e); }
}

async function findById(req, res, next) {
  try {
    const prod = await svc.findById(req.params.id, req.user);
    res.status(200).json({ success: true, data: prod });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const prod = await svc.create(req.body, req.user);
    res.status(201).json({ success: true, data: prod });
  } catch (e) { next(e); }
}

module.exports = { listByItem, listByAl, findById, create };
