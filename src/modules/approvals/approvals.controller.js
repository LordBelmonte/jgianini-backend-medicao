'use strict';
const svc = require('./approvals.service');

async function approveFiscal(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.approveFiscal(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function approveResponsible(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.approveResponsible(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function approveCoordinator(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.approveCoordinator(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function approveDirector(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.approveDirector(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function returnDirector(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.returnDirector(req.params.id, req.body, req.user) }); }
  catch (e) { next(e); }
}
async function listApprovals(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.listApprovals(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
module.exports = { approveFiscal, approveResponsible, approveCoordinator, approveDirector, returnDirector, listApprovals };
