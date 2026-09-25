'use strict';

/**
 * Controller de Usuários
 *
 * Referência: Documento 2 — seção 5
 *             Documento 4 — seções 9.1–9.5
 *
 * Responsabilidades:
 *   1. Receber requisição
 *   2. Obter parâmetros (body, params, query)
 *   3. Chamar validação estrutural
 *   4. Chamar Service com req.user como actor
 *   5. Retornar resposta HTTP no padrão definido (Doc4 §5)
 *
 * NÃO contém lógica de negócio.
 * NÃO acessa Prisma diretamente.
 */

const {
  validateCreate,
  validateUpdate,
  validateStatus,
  validateListParams,
} = require('./users.validation');

const {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  setUserStatus,
} = require('./users.service');

/**
 * GET /api/users
 * Permissão: users.view
 */
async function list(req, res, next) {
  try {
    const { valid, errors, params } = validateListParams(req.query);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors[0] },
      });
    }

    const result = await listUsers(params, req.user);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/users/:id
 * Permissão: users.view
 */
async function getById(req, res, next) {
  try {
    const user = await getUserById(req.params.id, req.user);
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/users
 * Permissão: users.create
 */
async function create(req, res, next) {
  try {
    const { valid, errors } = validateCreate(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors[0] },
      });
    }

    const user = await createUser(req.body, req.user);
    return res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/users/:id
 * Permissão: users.update
 */
async function update(req, res, next) {
  try {
    const { valid, errors } = validateUpdate(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors[0] },
      });
    }

    const user = await updateUser(req.params.id, req.body, req.user);
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/users/:id/status
 * Permissão: users.disable
 */
async function setStatus(req, res, next) {
  try {
    const { valid, errors } = validateStatus(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors[0] },
      });
    }

    const user = await setUserStatus(req.params.id, req.body.active, req.user);
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, create, update, setStatus };
