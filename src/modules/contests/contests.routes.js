'use strict';
const express = require('express');
const router  = express.Router({ mergeParams: true }); // herda :id de /measurements/:id
const ctrl    = require('./contests.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// GET /api/measurements/:id/contests
router.get('/',                           requirePermission('measurements.view'),           ctrl.listByMeasurement);
// POST /api/measurements/:id/contest
router.post('/',                          requirePermission('measurements.contest'),         ctrl.contest);
// GET /api/measurements/:id/contests/:contestId
router.get('/:contestId',                 requirePermission('measurements.view'),           ctrl.findById);
// POST /api/measurements/:id/contests/:contestId/resolve
router.post('/:contestId/resolve',        requirePermission('measurements.resolve_contest'), ctrl.resolveContest);

module.exports = router;
