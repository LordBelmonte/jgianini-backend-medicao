'use strict';
const express = require('express');
const ctrl    = require('./additives.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

const contractRouter = express.Router({ mergeParams: true }); // herda :contractId
const additiveRouter = express.Router();

contractRouter.use(authenticate);
additiveRouter.use(authenticate);

// Rotas aninhadas em /api/contracts/:contractId/additives
contractRouter.get ('/',    requirePermission('additives.view'),    ctrl.list);
contractRouter.post('/',    requirePermission('additives.create'),  ctrl.create);

// Rotas em /api/additives/:id
additiveRouter.get ('/:id',         requirePermission('additives.view'),    ctrl.findById);
additiveRouter.patch('/:id',        requirePermission('additives.create'),  ctrl.update);
additiveRouter.post('/:id/submit',  requirePermission('additives.create'),  ctrl.submit);
additiveRouter.post('/:id/approve', requirePermission('additives.approve'), ctrl.approve);
additiveRouter.post('/:id/reject',  requirePermission('additives.reject'),  ctrl.reject);
additiveRouter.post('/:id/cancel',  requirePermission('additives.create'),  ctrl.cancel);

module.exports = { contractRouter, additiveRouter };
