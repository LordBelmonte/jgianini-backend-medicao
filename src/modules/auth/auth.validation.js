'use strict';

/**
 * Validações de entrada do módulo de autenticação
 * Referência: Documento 2 — seção 8 (validações estruturais)
 *
 * Responsabilidade: validar formato e presença dos campos.
 * Regras de negócio (ex: usuário ativo, senha correta) pertencem ao Service.
 */

/**
 * Valida o body do POST /api/auth/login
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateLogin(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body inválido.'] };
  }

  const { email, password } = body;

  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.push('O campo "email" é obrigatório.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.push('O campo "email" deve ser um endereço de e-mail válido.');
  }

  if (!password || typeof password !== 'string' || !password.trim()) {
    errors.push('O campo "password" é obrigatório.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateLogin };
