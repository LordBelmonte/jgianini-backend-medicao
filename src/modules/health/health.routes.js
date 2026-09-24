'use strict';

const { Router } = require('express');
const router = Router();

/**
 * GET /api/health
 *
 * Health check da API.
 * Confirma que o servidor está no ar.
 * Não contém regra de negócio.
 *
 * Resposta conforme Documento 4 — seção 5:
 * { "success": true, "data": { "status": "ok" } }
 */
router.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      status: 'ok',
    },
  });
});

module.exports = router;
