'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./reports.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);
router.get('/measurements', requirePermission('reports.view'), ctrl.measurements);
router.get('/payments',     requirePermission('reports.view'), ctrl.payments);
router.get('/als',          requirePermission('reports.view'), ctrl.als);
router.get('/reworks',      requirePermission('reports.view'), ctrl.reworks);
router.get('/audit-logs',   requirePermission('audit.view'),   ctrl.auditLogs);

module.exports = router;
