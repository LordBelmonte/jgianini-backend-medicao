'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./productions.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

// POST /api/productions               — registrar produção
router.post('/',        requirePermission('measurements.create'),  ctrl.create);
// GET  /api/productions/:id           — buscar por ID
router.get('/:id',      requirePermission('measurements.view'),    ctrl.findById);
// GET  /api/productions/item/:measurementItemId
router.get('/item/:measurementItemId', requirePermission('measurements.view'), ctrl.listByItem);
// GET  /api/productions/al/:alId
router.get('/al/:alId', requirePermission('als.view'),             ctrl.listByAl);

module.exports = router;
