'use strict';

/**
 * Validações do módulo de Serviços
 *
 * Referência: Documento 2 — seção 8
 *             Documento 3 — §15
 *             Documento 7 — §3 (unidades oficiais: M2, UN, DIA)
 */

const VALID_UNITS = ['M2', 'UN', 'DIA'];

/** POST /api/services */
function validateCreate(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const errors = [];
  const { code, name, unit } = body;

  if (!code || typeof code !== 'string' || !code.trim())
    errors.push('O campo "code" é obrigatório.');

  if (!name || typeof name !== 'string' || !name.trim())
    errors.push('O campo "name" é obrigatório.');

  if (!unit || !VALID_UNITS.includes(String(unit).toUpperCase()))
    errors.push(`O campo "unit" é obrigatório e deve ser um de: ${VALID_UNITS.join(', ')}.`);

  if (body.requiresAl !== undefined && typeof body.requiresAl !== 'boolean')
    errors.push('O campo "requiresAl" deve ser um booleano (true ou false).');

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/services/:id */
function validateUpdate(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const { code, name, unit, requiresAl } = body;
  const hasAny = code !== undefined || name !== undefined || unit !== undefined || requiresAl !== undefined;

  if (!hasAny) return { valid: false, errors: ['Nenhum campo foi informado para atualização.'] };

  const errors = [];

  if (code !== undefined && (typeof code !== 'string' || !code.trim()))
    errors.push('O campo "code" não pode ser vazio.');

  if (name !== undefined && (typeof name !== 'string' || !name.trim()))
    errors.push('O campo "name" não pode ser vazio.');

  if (unit !== undefined && !VALID_UNITS.includes(String(unit).toUpperCase()))
    errors.push(`O campo "unit" deve ser um de: ${VALID_UNITS.join(', ')}.`);

  if (requiresAl !== undefined && typeof requiresAl !== 'boolean')
    errors.push('O campo "requiresAl" deve ser um booleano.');

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/services/:id/status */
function validateStatus(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };
  if (body.active === undefined || body.active === null)
    return { valid: false, errors: ['O campo "active" é obrigatório.'] };
  if (typeof body.active !== 'boolean')
    return { valid: false, errors: ['O campo "active" deve ser um booleano (true ou false).'] };
  return { valid: true, errors: [] };
}

/** GET /api/services — parâmetros de listagem */
function validateListParams(query) {
  const errors = [];
  const params = {};

  if (query.name) params.name = String(query.name).trim();
  if (query.code) params.code = String(query.code).trim();

  if (query.unit) {
    const unitUp = String(query.unit).toUpperCase();
    if (!VALID_UNITS.includes(unitUp)) errors.push(`O parâmetro "unit" deve ser um de: ${VALID_UNITS.join(', ')}.`);
    else params.unit = unitUp;
  }

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
