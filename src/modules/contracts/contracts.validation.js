'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE DADOS DE CONTRATOS
// Responsável por validar entrada de dados, SEM regras de negócio.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validação para criação de contrato.
 */
function validateCreate(data) {
  const errors = [];

  // work_id: obrigatório
  if (!data.work_id || typeof data.work_id !== 'string' || data.work_id.trim() === '') {
    errors.push({ field: 'work_id', message: 'Obra é obrigatória.' });
  }

  // contractor_id: obrigatório
  if (!data.contractor_id || typeof data.contractor_id !== 'string' || data.contractor_id.trim() === '') {
    errors.push({ field: 'contractor_id', message: 'Empreiteiro é obrigatório.' });
  }

  // contract_number: obrigatório e não-vazio (P-24: campo livre controlado)
  if (!data.contract_number || typeof data.contract_number !== 'string' || data.contract_number.trim() === '') {
    errors.push({ field: 'contract_number', message: 'Número do contrato é obrigatório.' });
  }

  // start_date e end_date: opcionais, mas se presentes, devem ser datas válidas
  if (data.start_date) {
    const start = new Date(data.start_date);
    if (isNaN(start.getTime())) {
      errors.push({ field: 'start_date', message: 'Data de início inválida.' });
    }
  }

  if (data.end_date) {
    const end = new Date(data.end_date);
    if (isNaN(end.getTime())) {
      errors.push({ field: 'end_date', message: 'Data de término inválida.' });
    }
  }

  // retention_percent: 0–100 (P-14.1, P-14.2)
  const retention = parseFloat(data.retention_percent);
  if (isNaN(retention) || retention < 0 || retention > 100) {
    errors.push({ field: 'retention_percent', message: 'Retenção deve ser um percentual entre 0 e 100.' });
  }

  // notes: opcional, string
  if (data.notes && typeof data.notes !== 'string') {
    errors.push({ field: 'notes', message: 'Observações devem ser texto.' });
  }

  return errors;
}

/**
 * Validação para atualização administrativa de contrato.
 */
function validateUpdate(data) {
  const errors = [];

  // start_date e end_date: opcionais, mas se presentes, válidas
  if (data.start_date !== undefined) {
    if (data.start_date === null) {
      // Permite null
    } else {
      const start = new Date(data.start_date);
      if (isNaN(start.getTime())) {
        errors.push({ field: 'start_date', message: 'Data de início inválida.' });
      }
    }
  }

  if (data.end_date !== undefined) {
    if (data.end_date === null) {
      // Permite null
    } else {
      const end = new Date(data.end_date);
      if (isNaN(end.getTime())) {
        errors.push({ field: 'end_date', message: 'Data de término inválida.' });
      }
    }
  }

  // retention_percent: 0–100 (P-14.2, P-25)
  if (data.retention_percent !== undefined) {
    const retention = parseFloat(data.retention_percent);
    if (isNaN(retention) || retention < 0 || retention > 100) {
      errors.push({ field: 'retention_percent', message: 'Retenção deve ser um percentual entre 0 e 100.' });
    }
  }

  // notes: opcional, string ou null
  if (data.notes !== undefined && data.notes !== null && typeof data.notes !== 'string') {
    errors.push({ field: 'notes', message: 'Observações devem ser texto.' });
  }

  return errors;
}

/**
 * Validação para adição de serviço ao contrato.
 */
function validateServiceCreate(data) {
  const errors = [];

  // service_id: obrigatório
  if (!data.service_id || typeof data.service_id !== 'string' || data.service_id.trim() === '') {
    errors.push({ field: 'service_id', message: 'Serviço é obrigatório.' });
  }

  // quantity: obrigatório, decimal > 0
  const quantity = parseFloat(data.quantity);
  if (isNaN(quantity) || quantity <= 0) {
    errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });
  }

  // unit_price: obrigatório, decimal >= 0
  const unitPrice = parseFloat(data.unit_price);
  if (isNaN(unitPrice) || unitPrice < 0) {
    errors.push({ field: 'unit_price', message: 'Preço unitário deve ser maior ou igual a zero.' });
  }

  return errors;
}

/**
 * Validação para atualização de serviço do contrato.
 */
function validateServiceUpdate(data) {
  const errors = [];

  // quantity: opcional, mas se presente, decimal > 0
  if (data.quantity !== undefined) {
    const quantity = parseFloat(data.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      errors.push({ field: 'quantity', message: 'Quantidade deve ser maior que zero.' });
    }
  }

  // unit_price: opcional, mas se presente, decimal >= 0
  if (data.unit_price !== undefined) {
    const unitPrice = parseFloat(data.unit_price);
    if (isNaN(unitPrice) || unitPrice < 0) {
      errors.push({ field: 'unit_price', message: 'Preço unitário deve ser maior ou igual a zero.' });
    }
  }

  return errors;
}

/**
 * Valida transição de status conforme P-09 e P-23.
 * Retorna erro se transição inválida.
 */
function validateStatusTransition(from, to) {
  const validTransitions = {
    DRAFT: ['ACTIVE'],
    ACTIVE: ['SUSPENDED', 'CLOSED'],
    SUSPENDED: ['ACTIVE', 'CLOSED'],
    CLOSED: [], // CLOSED é terminal (P-20)
  };

  if (!validTransitions[from]) {
    return `Status de origem inválido: ${from}`;
  }

  if (!validTransitions[from].includes(to)) {
    return `Transição inválida: ${from} → ${to}. Transições permitidas: ${validTransitions[from].join(', ')}`;
  }

  return null; // válido
}

module.exports = {
  validateCreate,
  validateUpdate,
  validateServiceCreate,
  validateServiceUpdate,
  validateStatusTransition,
};