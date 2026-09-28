'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE PRODUÇÃO
// ─────────────────────────────────────────────────────────────────────────────

function validateCreate(data) {
  const errors = [];

  if (!data.measurement_item_id || typeof data.measurement_item_id !== 'string' || data.measurement_item_id.trim() === '') {
    errors.push({ field: 'measurement_item_id', message: 'Item de medição é obrigatório.' });
  }
  if (!data.al_id || typeof data.al_id !== 'string' || data.al_id.trim() === '') {
    errors.push({ field: 'al_id', message: 'AL é obrigatória.' });
  }
  const qty = parseFloat(data.quantity);
  if (isNaN(qty) || qty <= 0) {
    errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });
  }

  return errors;
}

module.exports = { validateCreate };
