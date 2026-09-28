'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE ALs
// ─────────────────────────────────────────────────────────────────────────────

function validateImport(data) {
  const errors = [];

  if (!data.work_id || typeof data.work_id !== 'string' || data.work_id.trim() === '') {
    errors.push({ field: 'work_id', message: 'Obra é obrigatória.' });
  }
  if (!data.code || typeof data.code !== 'string' || data.code.trim() === '') {
    errors.push({ field: 'code', message: 'Código da AL é obrigatório.' });
  }
  const qty = parseFloat(data.quantity);
  if (isNaN(qty) || qty <= 0) {
    errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });
  }
  if (data.contract_id !== undefined && data.contract_id !== null && typeof data.contract_id !== 'string') {
    errors.push({ field: 'contract_id', message: 'contract_id inválido.' });
  }
  if (data.service_id !== undefined && data.service_id !== null && typeof data.service_id !== 'string') {
    errors.push({ field: 'service_id', message: 'service_id inválido.' });
  }

  return errors;
}

function validateCancel(data) {
  const errors = [];
  if (!data.reason || typeof data.reason !== 'string' || data.reason.trim() === '') {
    errors.push({ field: 'reason', message: 'Motivo do cancelamento é obrigatório.' });
  }
  return errors;
}

function validateLinkContractor(data) {
  const errors = [];
  if (!data.contractor_id || typeof data.contractor_id !== 'string') {
    errors.push({ field: 'contractor_id', message: 'contractor_id é obrigatório.' });
  }
  return errors;
}

module.exports = { validateImport, validateCancel, validateLinkContractor };
