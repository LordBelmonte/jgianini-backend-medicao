'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./als.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// GET /api/als
router.get('/',         requirePermission('als.view'),    ctrl.list);
// GET /api/als/:id
router.get('/:id',      requirePermission('als.view'),    ctrl.findById);
// GET /api/als/:id/balance
router.get('/:id/balance', requirePermission('als.view'), ctrl.balance);
// POST /api/als/import
router.post('/import',  requirePermission('als.import'),  ctrl.importAl);
// POST /api/als/:id/approve
router.post('/:id/approve', requirePermission('als.approve'), ctrl.approve);
// POST /api/als/:id/cancel
router.post('/:id/cancel',  requirePermission('als.import'),  ctrl.cancel);
// POST /api/als/:id/contractors
router.post('/:id/contractors',               requirePermission('als.link'), ctrl.linkContractor);
// DELETE /api/als/:id/contractors/:contractorId
router.delete('/:id/contractors/:contractorId', requirePermission('als.link'), ctrl.unlinkContractor);

module.exports = router;
