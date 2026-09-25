'use strict';

/**
 * Rotas de Serviços
 * Referência: Documento 4 — seção 13
 *             Documento 5 — §11
 */

const { Router }        = require('express');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');
const ctrl              = require('./services.controller');

const router = Router();

router.use(authenticate);

router.get   ('/',            requirePermission('services.view'),   ctrl.list);
router.get   ('/:id',         requirePermission('services.view'),   ctrl.getById);
router.post  ('/',            requirePermission('services.create'),  ctrl.create);
router.patch ('/:id',         requirePermission('services.update'),  ctrl.update);
router.patch ('/:id/status',  requirePermission('services.update'),  ctrl.setStatus);

module.exports = router;
