'use strict';
const express = require('express');
const router  = express.Router({ mergeParams: true });
const ctrl    = require('./payments.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// GET /api/measurements/:measurementId/payments
router.get ('/',       requirePermission('payments.view'),   ctrl.listByMeasurement);
// POST /api/measurements/:measurementId/payments
router.post('/',       requirePermission('payments.create'), ctrl.create);
// GET /api/payments/:id
// (montado separadamente no app.js via /api/payments/:id)

module.exports = router;
