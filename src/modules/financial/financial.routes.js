'use strict';
const express = require('express');
const router  = express.Router({ mergeParams: true }); // herda :id de /measurements/:id
const ctrl    = require('./financial.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);
router.get ('/',    requirePermission('measurements.view'),   ctrl.getByMeasurement);
router.patch('/',   requirePermission('measurements.update'), ctrl.updateAdjustments);

module.exports = router;
