'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE MEDIÇÕES
// ─────────────────────────────────────────────────────────────────────────────

function validateCreate(data) {
  const errors = [];

  if (!data.work_id || typeof data.work_id !== 'string') errors.push({ field: 'work_id', message: 'Obra é obrigatória.' });
  if (!data.contractor_id || typeof data.contractor_id !== 'string') errors.push({ field: 'contractor_id', message: 'Empreiteiro é obrigatório.' });
  if (!data.competence_month || typeof data.competence_month !== 'string' || !/^\d{4}-\d{2}$/.test(data.competence_month)) {
    errors.push({ field: 'competence_month', message: 'Mês de competência inválido. Use YYYY-MM.' });
  }
  if (data.is_exceptional === true) {
    if (!data.exceptional_reason || data.exceptional_reason.trim() === '') {
      errors.push({ field: 'exceptional_reason', message: 'Motivo é obrigatório para medição excepcional.' });
    }
  }

  return errors;
}

function validateItem(data, serviceUnit) {
  const errors = [];

  if (!data.service_id || typeof data.service_id !== 'string') errors.push({ field: 'service_id', message: 'Serviço é obrigatório.' });

  const qty = parseFloat(data.quantity);
  if (isNaN(qty) || qty <= 0) errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });

  const up = parseFloat(data.unit_price);
  if (isNaN(up) || up < 0) errors.push({ field: 'unit_price', message: 'Preço unitário deve ser >= 0.' });

  if (serviceUnit === 'M2') {
    if (!data.width_mm || parseInt(data.width_mm, 10) <= 0) errors.push({ field: 'width_mm', message: 'Largura (mm) obrigatória para serviço M2.' });
    if (!data.height_mm || parseInt(data.height_mm, 10) <= 0) errors.push({ field: 'height_mm', message: 'Altura (mm) obrigatória para serviço M2.' });
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

function validateReturn(data) {
  const errors = [];
  if (!data.reason || typeof data.reason !== 'string' || data.reason.trim() === '') {
    errors.push({ field: 'reason', message: 'Motivo da devolução é obrigatório.' });
  }
  return errors;
}

module.exports = { validateCreate, validateItem, validateCancel, validateReturn };
