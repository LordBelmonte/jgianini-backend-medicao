'use strict';
const express = require('express');
const router  = express.Router({ mergeParams: true }); // herda :id de /measurements/:id
const ctrl    = require('./approvals.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// GET /api/measurements/:id/approvals
router.get ('/',                requirePermission('measurements.view'),    ctrl.listApprovals);
// POST /api/measurements/:id/approve-fiscal
router.post('/approve-fiscal',  requirePermission('measurements.approve'), ctrl.approveFiscal);
// POST /api/measurements/:id/approve-responsible
router.post('/approve-responsible', requirePermission('measurements.approve'), ctrl.approveResponsible);
// POST /api/measurements/:id/approve-coordinator
router.post('/approve-coordinator', requirePermission('measurements.approve'), ctrl.approveCoordinator);
// POST /api/measurements/:id/approve-director
router.post('/approve-director',    requirePermission('measurements.approve'), ctrl.approveDirector);
// POST /api/measurements/:id/return-director
router.post('/return-director',     requirePermission('measurements.return'),  ctrl.returnDirector);

module.exports = router;
