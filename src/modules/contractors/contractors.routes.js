'use strict';

/**
 * Rotas de Empreiteiros
 * Referência: Documento 4 — seções 12.1–12.5
 *             Documento 5 — §10
 */

const { Router }        = require('express');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');
const ctrl              = require('./contractors.controller');

const router = Router();

router.use(authenticate);

router.get   ('/',            requirePermission('contractors.view'),   ctrl.list);
router.get   ('/:id',         requirePermission('contractors.view'),   ctrl.getById);
router.post  ('/',            requirePermission('contractors.create'),  ctrl.create);
router.patch ('/:id',         requirePermission('contractors.update'),  ctrl.update);
router.patch ('/:id/status',  requirePermission('contractors.update'),  ctrl.setStatus);
router.get   ('/:id/works',   requirePermission('contractors.view'),   ctrl.listWorks);

module.exports = router;
