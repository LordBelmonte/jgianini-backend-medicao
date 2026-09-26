'use strict';
const service = require('./contracts.service');

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER DE CONTRATOS
// Responsável por receber requisições HTTP e orquestrar respostas.
// NÃO contém regras de negócio.
// Formato de resposta: { success: true, data: ... } — Doc4 §5
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/contracts
 */
async function list(req, res, next) {
  try {
    const { page = 1, limit = 100, work_id, contractor_id } = req.query;
    const actor = req.user;

    const result = await service.list({
      page:         parseInt(page, 10),
      limit:        Math.min(parseInt(limit, 10), 200),
      actor,
      workId:       work_id,
      contractorId: contractor_id,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/contracts/:id
 */
async function findById(req, res, next) {
  try {
    const { id } = req.params;
    const actor = req.user;

    const contract = await service.findById(id, actor);
    return res.status(200).json({ success: true, data: contract });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/contracts
 */
async function create(req, res, next) {
  try {
    const actor = req.user;
    const data  = req.body;

    const contract = await service.create(data, actor);
    return res.status(201).json({ success: true, data: contract });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/contracts/:id
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const actor  = req.user;
    const data   = req.body;

    const updated = await service.update(id, data, actor);
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/contracts/:id/status
 */
async function updateStatus(req, res, next) {
  try {
    const { id }   = req.params;
    const actor    = req.user;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: { code: 'STATUS_REQUIRED', message: 'Campo "status" é obrigatório.' } });
    }

    const updated = await service.transitionStatus(id, status, actor);
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/contracts/:id/balance
 */
async function getBalance(req, res, next) {
  try {
    const { id } = req.params;
    const actor  = req.user;

    const balance = await service.getBalance(id, actor);
    return res.status(200).json({ success: true, data: balance });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/contracts/:id/services
 */
async function listServices(req, res, next) {
  try {
    const { id } = req.params;
    const actor  = req.user;

    const services = await service.listServices(id, actor);
    return res.status(200).json({ success: true, data: services });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/contracts/:id/services
 */
async function addService(req, res, next) {
  try {
    const { id } = req.params;
    const actor  = req.user;
    const data   = req.body;

    const contractService = await service.addService(id, data, actor);
    return res.status(201).json({ success: true, data: contractService });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/contracts/:id/services/:serviceId
 */
async function updateService(req, res, next) {
  try {
    const { serviceId } = req.params;
    const actor         = req.user;
    const data          = req.body;

    const updated = await service.updateService(serviceId, data, actor);
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/contracts/:id/services/:serviceId
 */
async function removeService(req, res, next) {
  try {
    const { serviceId } = req.params;
    const actor         = req.user;

    const removed = await service.removeService(serviceId, actor);
    return res.status(200).json({ success: true, data: removed });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  findById,
  create,
  update,
  updateStatus,
  getBalance,
  listServices,
  addService,
  updateService,
  removeService,
};
