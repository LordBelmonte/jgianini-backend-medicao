'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE ADITIVOS
// ─────────────────────────────────────────────────────────────────────────────

function validateCreate(data) {
  const errors = [];

  if (!data.reason || typeof data.reason !== 'string' || data.reason.trim() === '') {
    errors.push({ field: 'reason', message: 'Motivo é obrigatório.' });
  }

  if (data.services !== undefined) {
    if (!Array.isArray(data.services)) {
      errors.push({ field: 'services', message: 'Serviços deve ser um array.' });
    } else {
      data.services.forEach((svc, i) => {
        if (!svc.service_id || typeof svc.service_id !== 'string') {
          errors.push({ field: `services[${i}].service_id`, message: 'service_id é obrigatório.' });
        }
        if (svc.quantity_change !== undefined && svc.quantity_change !== null) {
          const qc = parseFloat(svc.quantity_change);
          if (isNaN(qc)) {
            errors.push({ field: `services[${i}].quantity_change`, message: 'quantity_change deve ser numérico.' });
          }
        }
        if (svc.new_unit_price !== undefined && svc.new_unit_price !== null) {
          const up = parseFloat(svc.new_unit_price);
          if (isNaN(up) || up < 0) {
            errors.push({ field: `services[${i}].new_unit_price`, message: 'new_unit_price deve ser >= 0.' });
          }
        }
        if (svc.quantity_change === undefined && svc.new_unit_price === undefined) {
          errors.push({ field: `services[${i}]`, message: 'Cada serviço deve informar quantity_change e/ou new_unit_price.' });
        }
      });
    }
  }

  return errors;
}

function validateUpdate(data) {
  const errors = [];

  if (data.reason !== undefined) {
    if (typeof data.reason !== 'string' || data.reason.trim() === '') {
      errors.push({ field: 'reason', message: 'Motivo não pode ser vazio.' });
    }
  }

  if (data.services !== undefined) {
    const errs = validateCreate({ reason: 'ok', services: data.services });
    // filtrar só os de services
    errors.push(...errs.filter(e => e.field.startsWith('services')));
  }

  return errors;
}

function validateReject(data) {
  const errors = [];
  if (!data.reason || typeof data.reason !== 'string' || data.reason.trim() === '') {
    errors.push({ field: 'reason', message: 'Motivo de rejeição é obrigatório.' });
  }
  return errors;
}

module.exports = { validateCreate, validateUpdate, validateReject };
