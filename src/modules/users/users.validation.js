'use strict';

/**
 * Validações do módulo de usuários
 *
 * Referência: Documento 2 — seção 8
 *             Documento 3 — §6 (campos obrigatórios)
 *             P-01 — Política de senha aprovada: Opção C
 *               mínimo 8 caracteres, 1 maiúscula, 1 número, 1 caractere especial
 *
 * Responsabilidade: validar estrutura e formato das entradas.
 * Regras de negócio (email duplicado, role existe) pertencem ao Service.
 */

// Regex da política P-01 — Opção C
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validações comuns reutilizáveis
 */
function validateEmail(email, errors) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.push('O campo "email" é obrigatório.');
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.push('O campo "email" deve ser um endereço de e-mail válido.');
  }
}

function validatePassword(password, errors, optional = false) {
  if (!password && optional) return;

  if (!password || typeof password !== 'string' || !password.trim()) {
    errors.push('O campo "password" é obrigatório.');
    return;
  }
  if (!PASSWORD_REGEX.test(password)) {
    errors.push(
      'A senha deve ter no mínimo 8 caracteres, incluindo 1 letra maiúscula, 1 número e 1 caractere especial.'
    );
  }
}

function validateRoleIds(roleIds, errors) {
  if (roleIds === undefined) return; // opcional
  if (!Array.isArray(roleIds)) {
    errors.push('O campo "roleIds" deve ser um array.');
    return;
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of roleIds) {
    if (!uuidRegex.test(id)) {
      errors.push(`"${id}" não é um UUID válido em roleIds.`);
    }
  }
}

/**
 * Valida o body de POST /api/users (criar usuário)
 */
function validateCreate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body inválido.'] };
  }

  const { name, email, password, roleIds } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('O campo "name" é obrigatório.');
  }

  validateEmail(email, errors);
  validatePassword(password, errors);
  validateRoleIds(roleIds, errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Valida o body de PATCH /api/users/:id (atualizar usuário)
 * Todos os campos são opcionais, mas pelo menos um deve ser informado.
 */
function validateUpdate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body inválido.'] };
  }

  const { name, email, password, roleIds } = body;
  const hasAnyField = name !== undefined || email !== undefined ||
                      password !== undefined || roleIds !== undefined;

  if (!hasAnyField) {
    return { valid: false, errors: ['Nenhum campo foi informado para atualização.'] };
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      errors.push('O campo "name" não pode ser vazio.');
    }
  }

  if (email !== undefined) {
    validateEmail(email, errors);
  }

  if (password !== undefined) {
    validatePassword(password, errors, false);
  }

  if (roleIds !== undefined) {
    validateRoleIds(roleIds, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida o body de PATCH /api/users/:id/status
 */
function validateStatus(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body inválido.'] };
  }

  if (body.active === undefined || body.active === null) {
    errors.push('O campo "active" é obrigatório.');
  } else if (typeof body.active !== 'boolean') {
    errors.push('O campo "active" deve ser um booleano (true ou false).');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida e normaliza os parâmetros de listagem
 */
function validateListParams(query) {
  const errors = [];
  const params = {};

  if (query.name)  params.name  = String(query.name).trim();
  if (query.email) params.email = String(query.email).trim();
  if (query.role)  params.role  = String(query.role).trim();

  if (query.active !== undefined) {
    if (query.active === 'true')       params.active = true;
    else if (query.active === 'false') params.active = false;
    else errors.push('O parâmetro "active" deve ser "true" ou "false".');
  }

  const page  = parseInt(query.page, 10);
  const limit = parseInt(query.limit, 10);

  params.page  = (!isNaN(page)  && page  > 0) ? page  : 1;
  params.limit = (!isNaN(limit) && limit > 0 && limit <= 100) ? limit : 20;

  return { valid: errors.length === 0, errors, params };
}

module.exports = {
  validateCreate,
  validateUpdate,
  validateStatus,
  validateListParams,
};
