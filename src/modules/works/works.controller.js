'use strict';

/**
 * Controller de Obras
 *
 * Referência: Documento 2 — seção 5
 *             Documento 4 — seções 11.1–11.6 + P-02 + P-03
 *
 * Responsabilidades:
 *   1. Receber requisição
 *   2. Validar estrutura (validation)
 *   3. Chamar service com req.user como actor
 *   4. Retornar resposta HTTP no padrão {success, data}
 *
 * NÃO contém lógica de negócio.
 * NÃO acessa Prisma diretamente.
 */

const {
  validateCreate, validateUpdate, validateStatus,
  validateLinkUser, validateLinkContractor, validateListParams,
} = require('./works.validation');

const {
  listWorks, getWorkById, createWork, updateWork, setWorkStatus,
  getUsersByWork, linkUserToWork, unlinkUserFromWork,
  getContractorsByWork, linkContractorToWork, unlinkContractorFromWork,
} = require('./works.service');

function validationError(res, message) {
  return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message } });
}

// ─── CRUD de obras ────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { valid, errors, params } = validateListParams(req.query);
    if (!valid) return validationError(res, errors[0]);
    const result = await listWorks(params, req.user);
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const work = await getWorkById(req.params.id, req.user);
    return res.status(200).json({ success: true, data: work });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { valid, errors } = validateCreate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const work = await createWork(req.body, req.user);
    return res.status(201).json({ success: true, data: work });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { valid, errors } = validateUpdate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const work = await updateWork(req.params.id, req.body, req.user);
    return res.status(200).json({ success: true, data: work });
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const { valid, errors } = validateStatus(req.body);
    if (!valid) return validationError(res, errors[0]);
    const work = await setWorkStatus(req.params.id, req.body.active, req.user);
    return res.status(200).json({ success: true, data: work });
  } catch (err) { next(err); }
}

// ─── vínculos obra↔usuário ────────────────────────────────────────────────────

async function listUsers(req, res, next) {
  try {
    const users = await getUsersByWork(req.params.id, req.user);
    return res.status(200).json({ success: true, data: users });
  } catch (err) { next(err); }
}

async function linkUser(req, res, next) {
  try {
    const { valid, errors } = validateLinkUser(req.body);
    if (!valid) return validationError(res, errors[0]);
    const result = await linkUserToWork(req.params.id, req.body.userId, req.user);
    return res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function unlinkUser(req, res, next) {
  try {
    await unlinkUserFromWork(req.params.id, req.params.userId, req.user);
    return res.status(200).json({ success: true, data: { message: 'Vínculo removido com sucesso.' } });
  } catch (err) { next(err); }
}

// ─── vínculos obra↔empreiteiro ────────────────────────────────────────────────

async function listContractors(req, res, next) {
  try {
    const contractors = await getContractorsByWork(req.params.id, req.user);
    return res.status(200).json({ success: true, data: contractors });
  } catch (err) { next(err); }
}

async function linkContractor(req, res, next) {
  try {
    const { valid, errors } = validateLinkContractor(req.body);
    if (!valid) return validationError(res, errors[0]);
    const result = await linkContractorToWork(req.params.id, req.body.contractorId, req.user);
    return res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function unlinkContractor(req, res, next) {
  try {
    await unlinkContractorFromWork(req.params.id, req.params.contractorId, req.user);
    return res.status(200).json({ success: true, data: { message: 'Vínculo removido com sucesso.' } });
  } catch (err) { next(err); }
}

module.exports = {
  list, getById, create, update, setStatus,
  listUsers, linkUser, unlinkUser,
  listContractors, linkContractor, unlinkContractor,
};
