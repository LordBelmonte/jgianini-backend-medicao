'use strict';

/**
 * Controller de Serviços
 * Referência: Documento 4 — seção 13
 */

const { validateCreate, validateUpdate, validateStatus, validateListParams } = require('./services.validation');
const { listServices, getServiceById, createService, updateService, setServiceStatus } = require('./services.service');

function validationError(res, message) {
  return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message } });
}

async function list(req, res, next) {
  try {
    const { valid, errors, params } = validateListParams(req.query);
    if (!valid) return validationError(res, errors[0]);
    const result = await listServices(params, req.user);
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const service = await getServiceById(req.params.id, req.user);
    return res.status(200).json({ success: true, data: service });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { valid, errors } = validateCreate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const service = await createService(req.body, req.user);
    return res.status(201).json({ success: true, data: service });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { valid, errors } = validateUpdate(req.body);
    if (!valid) return validationError(res, errors[0]);
    const service = await updateService(req.params.id, req.body, req.user);
    return res.status(200).json({ success: true, data: service });
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const { valid, errors } = validateStatus(req.body);
    if (!valid) return validationError(res, errors[0]);
    const service = await setServiceStatus(req.params.id, req.body.active, req.user);
    return res.status(200).json({ success: true, data: service });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, setStatus };
