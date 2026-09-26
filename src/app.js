'use strict';

const express = require('express');

const healthRoutes      = require('./modules/health/health.routes');
const authRoutes        = require('./modules/auth/auth.routes');
const usersRoutes       = require('./modules/users/users.routes');
const worksRoutes       = require('./modules/works/works.routes');
const contractorsRoutes = require('./modules/contractors/contractors.routes');
const servicesRoutes    = require('./modules/services/services.routes');
const contractsRoutes   = require('./modules/contracts/contracts.routes'); // Etapa 8
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
app.use('/api/auth',        authRoutes);
app.use('/api/users',       usersRoutes);
app.use('/api/works',       worksRoutes);
app.use('/api/contractors', contractorsRoutes);
app.use('/api/services',    servicesRoutes);  // dados estruturais — Etapa 7
app.use('/api/contracts',   contractsRoutes); // Etapa 8

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
