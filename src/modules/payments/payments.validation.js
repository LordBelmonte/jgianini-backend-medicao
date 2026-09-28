'use strict';

function validateCreate(data) {
  const errors = [];
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) errors.push({ field: 'amount', message: 'Valor deve ser maior que zero.' });
  if (!data.payment_date) errors.push({ field: 'payment_date', message: 'Data de pagamento é obrigatória.' });
  else {
    const d = new Date(data.payment_date);
    if (isNaN(d.getTime())) errors.push({ field: 'payment_date', message: 'Data de pagamento inválida.' });
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

module.exports = { validateCreate, validateCancel };
