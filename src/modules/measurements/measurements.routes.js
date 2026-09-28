'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./measurements.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);

router.get ('/',                        requirePermission('measurements.view'),    ctrl.list);
router.get ('/:id',                     requirePermission('measurements.view'),    ctrl.findById);
router.post('/',                        requirePermission('measurements.create'),  ctrl.create);
router.patch('/:id',                    requirePermission('measurements.update'),  ctrl.update);
router.post('/:id/items',               requirePermission('measurements.update'),  ctrl.addItem);
router.delete('/:id/items/:itemId',     requirePermission('measurements.update'),  ctrl.removeItem);
router.post('/:id/submit',              requirePermission('measurements.submit'),  ctrl.submit);
router.post('/:id/resubmit',            requirePermission('measurements.submit'),  ctrl.resubmit);
router.post('/:id/cancel',              requirePermission('measurements.cancel'),  ctrl.cancel);
router.post('/:id/return',              requirePermission('measurements.return'),  ctrl.returnToContractor);

module.exports = router;
