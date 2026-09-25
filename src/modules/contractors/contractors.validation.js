'use strict';

/**
 * Validações do módulo de Empreiteiros
 *
 * Referência: Documento 2 — seção 8
 *             Documento 3 — §13 (campos)
 *             P-04 A: document opcional, único quando informado
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/contractors */
function validateCreate(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const errors = [];
  const { name } = body;

  if (!name || typeof name !== 'string' || !name.trim())
    errors.push('O campo "name" é obrigatório.');

  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (!EMAIL_REGEX.test(String(body.email).trim()))
      errors.push('O campo "email" deve ser um endereço de e-mail válido.');
  }

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/contractors/:id */
function validateUpdate(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const { name, document, email, phone } = body;
  const hasAny = name !== undefined || document !== undefined ||
                 email !== undefined || phone !== undefined;

  if (!hasAny) return { valid: false, errors: ['Nenhum campo foi informado para atualização.'] };

  const errors = [];

  if (name !== undefined && (typeof name !== 'string' || !name.trim()))
    errors.push('O campo "name" não pode ser vazio.');

  if (email !== undefined && email !== null && email !== '') {
    if (!EMAIL_REGEX.test(String(email).trim()))
      errors.push('O campo "email" deve ser um endereço de e-mail válido.');
  }

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/contractors/:id/status */
function validateStatus(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };
  if (body.active === undefined || body.active === null)
    return { valid: false, errors: ['O campo "active" é obrigatório.'] };
  if (typeof body.active !== 'boolean')
    return { valid: false, errors: ['O campo "active" deve ser um booleano (true ou false).'] };
  return { valid: true, errors: [] };
}

/** GET /api/contractors — parâmetros de listagem */
function validateListParams(query) {
  const errors = [];
  const params = {};

  if (query.name)     params.name     = String(query.name).trim();
  if (query.document) params.document = String(query.document).trim();

  if (query.active !== undefined) {
    if      (query.active === 'true')  params.active = true;
    else if (query.active === 'false') params.active = false;
    else errors.push('O parâmetro "active" deve ser "true" ou "false".');
  }

  const page  = parseInt(query.page,  10);
  const limit = parseInt(query.limit, 10);
  params.page  = (!isNaN(page)  && page  > 0)               ? page  : 1;
  params.limit = (!isNaN(limit) && limit > 0 && limit <= 100) ? limit : 20;

  return { valid: errors.length === 0, errors, params };
}

module.exports = { validateCreate, validateUpdate, validateStatus, validateListParams };
