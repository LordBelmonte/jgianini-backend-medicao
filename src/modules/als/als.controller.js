'use strict';
const svc = require('./als.service');

async function list(req, res, next) {
  try {
    const { work_id, contract_id, service_id, status, page = 1, limit = 100 } = req.query;
    const result = await svc.list({
      workId:     work_id,
      contractId: contract_id,
      serviceId:  service_id,
      status,
      page:  parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 200),
    }, req.user);
    res.status(200).json({ success: true, ...result });
  } catch (e) { next(e); }
}

async function findById(req, res, next) {
  try {
    const al = await svc.findById(req.params.id, req.user);
    res.status(200).json({ success: true, data: al });
  } catch (e) { next(e); }
}

async function importAl(req, res, next) {
  try {
    const al = await svc.importAl(req.body, req.user);
    res.status(201).json({ success: true, data: al });
  } catch (e) { next(e); }
}

async function approve(req, res, next) {
  try {
    const al = await svc.approve(req.params.id, req.user);
    res.status(200).json({ success: true, data: al });
  } catch (e) { next(e); }
}

async function cancel(req, res, next) {
  try {
    const al = await svc.cancel(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, data: al });
  } catch (e) { next(e); }
}

async function balance(req, res, next) {
  try {
    const b = await svc.balance(req.params.id, req.user);
    res.status(200).json({ success: true, data: b });
  } catch (e) { next(e); }
}

async function linkContractor(req, res, next) {
  try {
    const link = await svc.linkContractor(req.params.id, req.body, req.user);
    res.status(201).json({ success: true, data: link });
  } catch (e) { next(e); }
}

async function unlinkContractor(req, res, next) {
  try {
    const result = await svc.unlinkContractor(req.params.id, req.params.contractorId, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (e) { next(e); }
}

module.exports = { list, findById, importAl, approve, cancel, balance, linkContractor, unlinkContractor };
