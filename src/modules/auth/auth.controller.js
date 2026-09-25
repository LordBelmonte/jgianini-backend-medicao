'use strict';

/**
 * Controller de Autenticação
 *
 * Referência: Documento 4 — seções 8.1, 8.2, 8.3
 *             Documento 2 — seção 5 (responsabilidades do Controller)
 *
 * Responsabilidades:
 *   1. Receber requisição
 *   2. Obter parâmetros do body
 *   3. Chamar validação estrutural
 *   4. Chamar Service
 *   5. Retornar resposta HTTP no padrão definido (Doc4 §5)
 *
 * NÃO contém lógica de negócio.
 * NÃO acessa Prisma diretamente.
 */

const { validateLogin }            = require('./auth.validation');
const { login, getMe }             = require('./auth.service');

/**
 * POST /api/auth/login
 * Público — não requer autenticação
 */
async function handleLogin(req, res, next) {
  try {
    const { valid, errors } = validateLogin(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors[0] },
      });
    }

    const { email, password } = req.body;
    const result = await login(email, password);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Protegido — requer middleware authenticate
 * req.user é injetado pelo middleware authenticate
 */
async function handleMe(req, res, next) {
  try {
    const user = await getMe(req.user.id);
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Protegido — requer middleware authenticate
 *
 * DT-01: JWT Stateless — sem tabela de sessões.
 * O logout é responsabilidade do cliente: basta descartar o token.
 * O endpoint existe para padronizar o fluxo no frontend e registrar o evento.
 */
async function handleLogout(req, res) {
  // Stateless: nada a invalidar no servidor.
  // O cliente deve descartar o token após esta resposta.
  return res.status(200).json({
    success: true,
    data: {
      message: 'Logout realizado. Descarte o token no cliente.',
    },
  });
}

module.exports = { handleLogin, handleMe, handleLogout };
