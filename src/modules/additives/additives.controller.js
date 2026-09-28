'use strict';
const svc = require('./additives.service');

async function list(req, res, next) {
  try {
    const items = await svc.list(req.params.contractId, req.user);
    res.status(200).json({ success: true, data: items });
  } catch (e) { next(e); }
}

async function findById(req, res, next) {
  try {
    const item = await svc.findById(req.params.id, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const item = await svc.create(req.params.contractId, req.body, req.user);
    res.status(201).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const item = await svc.update(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function submit(req, res, next) {
  try {
    const item = await svc.submit(req.params.id, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function approve(req, res, next) {
  try {
    const item = await svc.approve(req.params.id, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function reject(req, res, next) {
  try {
    const item = await svc.reject(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function cancel(req, res, next) {
  try {
    const item = await svc.cancel(req.params.id, req.user);
    res.status(200).json({ success: true, data: item });
  } catch (e) { next(e); }
}

module.exports = { list, findById, create, update, submit, approve, reject, cancel };
