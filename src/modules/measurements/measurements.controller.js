'use strict';
const svc = require('./measurements.service');

async function list(req, res, next) {
  try {
    const { work_id, contractor_id, contract_id, status, is_exceptional, competence_month, page, limit } = req.query;
    const result = await svc.list({
      workId:         work_id,
      contractorId:   contractor_id,
      contractId:     contract_id,
      status,
      isExceptional:  is_exceptional === 'true' ? true : is_exceptional === 'false' ? false : undefined,
      competenceMonth: competence_month,
      page:  parseInt(page  || 1, 10),
      limit: Math.min(parseInt(limit || 50, 10), 200),
    }, req.user);
    res.status(200).json({ success: true, ...result });
  } catch (e) { next(e); }
}

async function findById(req, res, next) {
  try {
    const m = await svc.findById(req.params.id, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const m = await svc.create(req.body, req.user);
    res.status(201).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const m = await svc.update(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function addItem(req, res, next) {
  try {
    const item = await svc.addItem(req.params.id, req.body, req.user);
    res.status(201).json({ success: true, data: item });
  } catch (e) { next(e); }
}

async function removeItem(req, res, next) {
  try {
    const result = await svc.removeItem(req.params.id, req.params.itemId, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (e) { next(e); }
}

async function submit(req, res, next) {
  try {
    const m = await svc.submit(req.params.id, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function cancel(req, res, next) {
  try {
    const m = await svc.cancel(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function returnToContractor(req, res, next) {
  try {
    const m = await svc.returnToContractor(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

async function resubmit(req, res, next) {
  try {
    const m = await svc.resubmit(req.params.id, req.user);
    res.status(200).json({ success: true, data: m });
  } catch (e) { next(e); }
}

module.exports = { list, findById, create, update, addItem, removeItem, submit, cancel, returnToContractor, resubmit };
