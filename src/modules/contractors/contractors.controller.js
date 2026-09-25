'use strict';

/**
 * Controller de Empreiteiros
 * Referência: Documento 4 — seções 12.1–12.5
 */

const {
  validateCreate, validateUpdate, validateStatus, validateListParams,
} = require('./contractors.validation');

const {
  listContractors, getContractorById, createContractor,
  updateContractor, setContractorStatus, getWorksByContractor,
} = require('./contractors.service');

function validationError(res, message) {
  return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message } });
}

async function list(req, res, next) {
  try {
    const { valid, errors, params } = validateListParams(req.query);
    if (!valid) return validationError(res, errors[0]);
    const result = await listContractors(params, req.user);
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const contractor = await getContractorById(req.params.id, req.user);
    return res.status(200).json({ success: true, data: contractor });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { valid, errors } = validateCreate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const contractor = await createContractor(req.body, req.user);
    return res.status(201).json({ success: true, data: contractor });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { valid, errors } = validateUpdate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const contractor = await updateContractor(req.params.id, req.body, req.user);
    return res.status(200).json({ success: true, data: contractor });
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const { valid, errors } = validateStatus(req.body);
    if (!valid) return validationError(res, errors[0]);
    const contractor = await setContractorStatus(req.params.id, req.body.active, req.user);
    return res.status(200).json({ success: true, data: contractor });
  } catch (err) { next(err); }
}

async function listWorks(req, res, next) {
  try {
    const works = await getWorksByContractor(req.params.id, req.user);
    return res.status(200).json({ success: true, data: works });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, setStatus, listWorks };
