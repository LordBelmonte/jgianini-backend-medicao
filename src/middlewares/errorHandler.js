'use strict';

const env = require('../config/env');

/**
 * Middleware global de tratamento de erros.
 *
 * Formato de resposta definido no Documento 4 — Técnico de APIs, seção 5:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "ERROR_CODE",
 *     "message": "Mensagem para o usuário"
 *   }
 * }
 *
 * Regras:
 * - Nunca retornar HTTP 200 para erros.
 * - Nunca expor stack trace ou informações internas em produção.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Erro interno do servidor.';

  // Log técnico no servidor (não enviado ao cliente)
  if (env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.originalUrl} — ${statusCode} ${code}: ${message}`);
    if (env.NODE_ENV === 'development' && err.stack) {
      console.error(err.stack);
    }
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}

module.exports = errorHandler;
