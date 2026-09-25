'use strict';

const express = require('express');

const healthRoutes      = require('./modules/health/health.routes');
const authRoutes        = require('./modules/auth/auth.routes');
const usersRoutes       = require('./modules/users/users.routes');
const worksRoutes       = require('./modules/works/works.routes');
const contractorsRoutes = require('./modules/contractors/contractors.routes');
const notFound          = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// ─────────────────────────────────────────
// PARSERS
// ─────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// ROTAS
// ─────────────────────────────────────────
app.use('/api/health',      healthRoutes);
app.use('/api/auth',        authRoutes);         // login, me, logout — DT-01 JWT Stateless
app.use('/api/users',       usersRoutes);        // CRUD de usuários — Etapa 4
app.use('/api/works',       worksRoutes);        // CRUD de obras + vínculos — Etapa 5
app.use('/api/contractors', contractorsRoutes);  // CRUD de empreiteiros — Etapa 6

// ─────────────────────────────────────────
// 404 — deve vir após todas as rotas
// ─────────────────────────────────────────
app.use(notFound);

// ─────────────────────────────────────────
// TRATAMENTO GLOBAL DE ERROS
// Deve ser o último middleware registrado.
// Assinatura de 4 parâmetros é obrigatória para o Express reconhecer como error handler.
// ─────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
