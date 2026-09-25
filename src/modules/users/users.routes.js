'use strict';

/**
 * Rotas de Usuários
 *
 * Referência: Documento 4 — seções 9.1–9.5
 *             Documento 5 — §8 (permissões por perfil)
 *
 * Todos os endpoints exigem autenticação (authenticate).
 * Cada endpoint exige a permissão granular correspondente (requirePermission).
 *
 * Permissões (Doc5 §38):
 *   users.view    — listar e buscar
 *   users.create  — criar
 *   users.update  — atualizar dados
 *   users.disable — ativar/desativar
 */

const { Router } = require('express');
const authenticate       = require('../../middlewares/authenticate');
const requirePermission  = require('../../middlewares/requirePermission');
const ctrl               = require('./users.controller');

const router = Router();

// Todos os endpoints de usuários requerem autenticação
router.use(authenticate);

// GET  /api/users        — listar com filtros e paginação
router.get(  '/',          requirePermission('users.view'),    ctrl.list);

// GET  /api/users/:id    — buscar por ID
router.get(  '/:id',       requirePermission('users.view'),    ctrl.getById);

// POST /api/users        — criar usuário
router.post( '/',          requirePermission('users.create'),  ctrl.create);

// PATCH /api/users/:id   — atualizar dados
router.patch('/:id',       requirePermission('users.update'),  ctrl.update);

// PATCH /api/users/:id/status — ativar/desativar
router.patch('/:id/status', requirePermission('users.disable'), ctrl.setStatus);

module.exports = router;
