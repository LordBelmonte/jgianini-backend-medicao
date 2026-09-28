'use strict';
// Rotas raiz de /api/payments — findById e cancel
const express = require('express');
const router  = express.Router();
const ctrl    = require('./payments.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);
router.get ('/:id',        requirePermission('payments.view'),   ctrl.findById);
router.post('/:id/cancel', requirePermission('payments.cancel'), ctrl.cancel);

module.exports = router;
