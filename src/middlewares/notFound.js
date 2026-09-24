'use strict';

/**
 * Middleware para rotas não encontradas (404).
 * Deve ser registrado após todas as rotas em app.js.
 */
function notFound(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
    },
  });
}

module.exports = notFound;
