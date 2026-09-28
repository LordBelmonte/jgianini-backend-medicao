'use strict';

function validateCreate(data) {
  const errors = [];
  if (!data.measurement_id || typeof data.measurement_id !== 'string') errors.push({ field: 'measurement_id', message: 'Medição é obrigatória.' });
  if (!data.reason_id || typeof data.reason_id !== 'string') errors.push({ field: 'reason_id', message: 'Motivo é obrigatório.' });
  const qty = parseFloat(data.quantity);
  if (isNaN(qty) || qty <= 0) errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });
  const up = parseFloat(data.unit_price);
  if (isNaN(up) || up < 0) errors.push({ field: 'unit_price', message: 'Preço unitário deve ser >= 0.' });
  return errors;
}

module.exports = { validateCreate };
