'use strict';

const express = require('express');

const healthRoutes      = require('./modules/health/health.routes');
const authRoutes        = require('./modules/auth/auth.routes');
const usersRoutes       = require('./modules/users/users.routes');
const worksRoutes       = require('./modules/works/works.routes');
const contractorsRoutes = require('./modules/contractors/contractors.routes');
const servicesRoutes    = require('./modules/services/services.routes');
const contractsRoutes   = require('./modules/contracts/contracts.routes');   // Etapa 8
const { contractRouter: additivesContractRouter, additiveRouter: additivesRouter }
                        = require('./modules/additives/additives.routes');   // Etapa 9
const alsRoutes         = require('./modules/als/als.routes');               // Etapa 9
const productionsRoutes = require('./modules/productions/productions.routes'); // Etapa 9
// Prompt 1/2 — Medições + Retrabalho + Aprovações + Contestação
const measurementsRoutes  = require('./modules/measurements/measurements.routes');
const reworksRoutes       = require('./modules/reworks/reworks.routes');
const approvalsRoutes     = require('./modules/approvals/approvals.routes');
const contestsRoutes      = require('./modules/contests/contests.routes');
// Prompt 2/2 — Financeiro + Pagamentos + Documentos + Notificações + Relatórios
const financialRoutes     = require('./modules/financial/financial.routes');
const paymentsRoutes      = require('./modules/payments/payments.routes');
const paymentsRootRoutes  = require('./modules/payments/payments.root.routes');
const documentsRoutes     = require('./modules/documents/documents.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const reportsRoutes       = require('./modules/reports/reports.routes');
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
app.use('/api/services',    servicesRoutes);   // dados estruturais — Etapa 7
app.use('/api/contracts',   contractsRoutes);  // Etapa 8
// Etapa 9 — Aditivos: rotas aninhadas em /contracts/:contractId/additives + raiz /additives
app.use('/api/contracts/:contractId/additives', additivesContractRouter);
app.use('/api/additives',   additivesRouter);
// Etapa 9 — ALs e Produção
app.use('/api/als',         alsRoutes);
app.use('/api/productions', productionsRoutes);
// Prompt 1/2 — Medições + Retrabalho + Aprovações + Contestação
app.use('/api/measurements', measurementsRoutes);
// Financeiro como sub-rota de medições (mergeParams)
app.use('/api/measurements/:id/financial',  financialRoutes);
// Pagamentos como sub-rota de medições (mergeParams)
app.use('/api/measurements/:measurementId/payments', paymentsRoutes);
// Pagamentos raiz: GET /api/payments/:id e POST /api/payments/:id/cancel
app.use('/api/payments', paymentsRootRoutes);
// Aprovações e Contestações como sub-rotas de medições (mergeParams)
app.use('/api/measurements/:id/approvals', approvalsRoutes);
app.use('/api/measurements/:id/contests',  contestsRoutes);
// Retrabalho: raiz e aninhado
app.use('/api/reworks', reworksRoutes);
// Prompt 2/2
app.use('/api/documents',     documentsRoutes);
app.use('/api/notifications',  notificationsRoutes);
app.use('/api/reports',        reportsRoutes);

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
