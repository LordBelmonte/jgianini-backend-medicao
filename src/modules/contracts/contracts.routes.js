'use strict';
const express = require('express');
const router = express.Router();
const controller = require('./contracts.controller');
const authenticate = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

// ─────────────────────────────────────────────────────────────────────────────
// ROTAS DE CONTRATOS
// Todas exigem autenticação e permissões específicas.
// ─────────────────────────────────────────────────────────────────────────────

// Todas as rotas exigem autenticação
router.use(authenticate);

// GET /api/contracts
router.get('/',
  requirePermission('contracts.view'),
  controller.list
);

// GET /api/contracts/:id
router.get('/:id',
  requirePermission('contracts.view'),
  controller.findById
);

// POST /api/contracts
router.post('/',
  requirePermission('contracts.create'),
  controller.create
);

// PATCH /api/contracts/:id (atualização administrativa)
router.patch('/:id',
  requirePermission('contracts.update'),
  controller.update
);

// PATCH /api/contracts/:id/status (transição de status)
router.patch('/:id/status',
  requirePermission('contracts.update'),
  controller.updateStatus
);

// GET /api/contracts/:id/balance (saldo do contrato)
router.get('/:id/balance',
  requirePermission('contracts.view'),
  controller.getBalance
);

// GET /api/contracts/:id/services
router.get('/:id/services',
  requirePermission('contracts.view'),
  controller.listServices
);

// POST /api/contracts/:id/services
router.post('/:id/services',
  requirePermission('contracts.update'),
  controller.addService
);

// PATCH /api/contracts/:id/services/:serviceId
router.patch('/:id/services/:serviceId',
  requirePermission('contracts.update'),
  controller.updateService
);

// DELETE /api/contracts/:id/services/:serviceId
router.delete('/:id/services/:serviceId',
  requirePermission('contracts.update'),
  controller.removeService
);

module.exports = router;