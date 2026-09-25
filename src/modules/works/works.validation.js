'use strict';

/**
 * Validações do módulo de Obras
 *
 * Referência: Documento 2 — seção 8
 *             Documento 3 — §11 (campos obrigatórios)
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/** POST /api/works */
function validateCreate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const { code, name, clientName } = body;

  if (!code || typeof code !== 'string' || !code.trim())
    errors.push('O campo "code" é obrigatório.');

  if (!name || typeof name !== 'string' || !name.trim())
    errors.push('O campo "name" é obrigatório.');

  if (!clientName || typeof clientName !== 'string' || !clientName.trim())
    errors.push('O campo "clientName" é obrigatório.');

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/works/:id */
function validateUpdate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  const { code, name, clientName, address } = body;
  const hasAny = code !== undefined || name !== undefined ||
                 clientName !== undefined || address !== undefined;

  if (!hasAny) return { valid: false, errors: ['Nenhum campo foi informado para atualização.'] };

  if (code      !== undefined && (typeof code      !== 'string' || !code.trim()))
    errors.push('O campo "code" não pode ser vazio.');
  if (name      !== undefined && (typeof name      !== 'string' || !name.trim()))
    errors.push('O campo "name" não pode ser vazio.');
  if (clientName !== undefined && (typeof clientName !== 'string' || !clientName.trim()))
    errors.push('O campo "clientName" não pode ser vazio.');

  return { valid: errors.length === 0, errors };
}

/** PATCH /api/works/:id/status */
function validateStatus(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  if (body.active === undefined || body.active === null)
    return { valid: false, errors: ['O campo "active" é obrigatório.'] };

  if (typeof body.active !== 'boolean')
    return { valid: false, errors: ['O campo "active" deve ser um booleano (true ou false).'] };

  return { valid: true, errors: [] };
}

/** POST /api/works/:id/users */
function validateLinkUser(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  if (!body.userId || !isValidUuid(body.userId))
    return { valid: false, errors: ['"userId" deve ser um UUID válido.'] };

  return { valid: true, errors: [] };
}

/** POST /api/works/:id/contractors */
function validateLinkContractor(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Body inválido.'] };

  if (!body.contractorId || !isValidUuid(body.contractorId))
    return { valid: false, errors: ['"contractorId" deve ser um UUID válido.'] };

  return { valid: true, errors: [] };
}

/** GET /api/works — parâmetros de listagem */
function validateListParams(query) {
  const errors = [];
  const params = {};

  if (query.code)   params.code   = String(query.code).trim();
  if (query.name)   params.name   = String(query.name).trim();
  if (query.client) params.client = String(query.client).trim();
  if (query.status) {
    if (!['ACTIVE', 'INACTIVE'].includes(query.status.toUpperCase()))
      errors.push('O parâmetro "status" deve ser "ACTIVE" ou "INACTIVE".');
    else params.status = query.status.toUpperCase();
  }

  const page  = parseInt(query.page,  10);
  const limit = parseInt(query.limit, 10);
  params.page  = (!isNaN(page)  && page  > 0)              ? page  : 1;
  params.limit = (!isNaN(limit) && limit > 0 && limit <= 100) ? limit : 20;

  return { valid: errors.length === 0, errors, params };
}

module.exports = {
  validateCreate,
  validateUpdate,
  validateStatus,
  validateLinkUser,
  validateLinkContractor,
  validateListParams,
};
