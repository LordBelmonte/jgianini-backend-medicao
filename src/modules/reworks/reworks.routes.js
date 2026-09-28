'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./reworks.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// GET /api/rework-reasons
router.get('/reasons',                               requirePermission('measurements.view'),   ctrl.listReasons);
// GET /api/reworks/:id
router.get('/:id',                                   requirePermission('measurements.view'),   ctrl.findById);
// POST /api/reworks
router.post('/',                                     requirePermission('measurements.update'), ctrl.create);
// GET /api/measurements/:measurementId/reworks  (nested — montado no app.js)
router.get('/measurement/:measurementId',            requirePermission('measurements.view'),   ctrl.listByMeasurement);

module.exports = router;
