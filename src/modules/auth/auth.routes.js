'use strict';

/**
 * Rotas de Autenticação
 *
 * Referência: Documento 4 — seções 8.1, 8.2, 8.3
 *
 * Endpoints:
 *   POST /api/auth/login   — público
 *   GET  /api/auth/me      — protegido (requer token válido)
 *   POST /api/auth/logout  — protegido (requer token válido)
 */

const { Router } = require('express');
const { handleLogin, handleMe, handleLogout } = require('./auth.controller');
const authenticate = require('../../middlewares/authenticate');

const router = Router();

// Público
router.post('/login', handleLogin);

// Protegidos — exigem token JWT válido
router.get('/me',     authenticate, handleMe);
router.post('/logout',authenticate, handleLogout);

module.exports = router;
