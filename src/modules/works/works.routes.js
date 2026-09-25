'use strict';

/**
 * Rotas de Obras
 *
 * Referência: Documento 4 — seções 11.1–11.6, P-02, P-03
 *             Documento 5 — §9 (permissões por perfil)
 *
 * Todos os endpoints requerem autenticação.
 * Permissões granulares verificadas via requirePermission.
 * Restrições adicionais por perfil (somente Admin pode criar, etc.)
 * são verificadas no Service — não apenas na rota.
 */

const { Router }        = require('express');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');
const ctrl              = require('./works.controller');

const router = Router();

router.use(authenticate);

// ─── CRUD de obras ────────────────────────────────────────────────────────────
router.get   ('/',           requirePermission('works.view'),   ctrl.list);
router.get   ('/:id',        requirePermission('works.view'),   ctrl.getById);
router.post  ('/',           requirePermission('works.create'), ctrl.create);
router.patch ('/:id',        requirePermission('works.update'), ctrl.update);
router.patch ('/:id/status', requirePermission('works.update'), ctrl.setStatus);

// ─── vínculos obra↔usuário ────────────────────────────────────────────────────
router.get   ('/:id/users',            requirePermission('works.view'),   ctrl.listUsers);
router.post  ('/:id/users',            requirePermission('works.update'), ctrl.linkUser);
router.delete('/:id/users/:userId',    requirePermission('works.update'), ctrl.unlinkUser);

// ─── vínculos obra↔empreiteiro ────────────────────────────────────────────────
router.get   ('/:id/contractors',                   requirePermission('works.view'),   ctrl.listContractors);
router.post  ('/:id/contractors',                   requirePermission('works.update'), ctrl.linkContractor);
router.delete('/:id/contractors/:contractorId',     requirePermission('works.update'), ctrl.unlinkContractor);

module.exports = router;
