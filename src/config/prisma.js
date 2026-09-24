'use strict';

const { PrismaClient } = require('@prisma/client');

/**
 * Instância única do PrismaClient.
 *
 * Referência: Documento 3 — Técnico de Banco de Dados
 *
 * Em desenvolvimento, reutilizamos a instância para evitar
 * exceder o limite de conexões durante hot-reload (nodemon).
 */
const globalForPrisma = global;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
