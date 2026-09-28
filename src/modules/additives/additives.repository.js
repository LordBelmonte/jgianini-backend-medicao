'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITÓRIO DE ADITIVOS
// Somente acesso a dados — sem regras de negócio.
// ─────────────────────────────────────────────────────────────────────────────

const ADDITIVE_INCLUDE = {
  contract: { select: { id: true, work_id: true, contractor_id: true, contract_number: true, status: true } },
  creator:  { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  contract_additive_services: {
    include: { service: { select: { id: true, code: true, name: true, unit: true } } },
  },
};

async function list(contractId) {
  return prisma.contract_additives.findMany({
    where: { contract_id: contractId },
    include: ADDITIVE_INCLUDE,
    orderBy: { version_number: 'asc' },
  });
}

async function findById(id) {
  return prisma.contract_additives.findUnique({
    where: { id },
    include: ADDITIVE_INCLUDE,
  });
}

async function create(data) {
  return prisma.contract_additives.create({
    data,
    include: ADDITIVE_INCLUDE,
  });
}

async function update(id, data) {
  return prisma.contract_additives.update({
    where: { id },
    data,
    include: ADDITIVE_INCLUDE,
  });
}

/** Próximo version_number para o contrato (max + 1, ou 1 se nenhum existir). */
async function nextVersionNumber(contractId) {
  const result = await prisma.contract_additives.aggregate({
    where: { contract_id: contractId },
    _max: { version_number: true },
  });
  return (result._max.version_number ?? 0) + 1;
}

/** Adiciona itens de serviço ao aditivo. */
async function addServices(additiveId, items) {
  // items: [{ service_id, quantity_change, new_unit_price }]
  return prisma.contract_additive_services.createMany({
    data: items.map(i => ({ additive_id: additiveId, ...i })),
  });
}

/** Remove todos os itens de serviço de um aditivo em DRAFT (para substituição na edição). */
async function clearServices(additiveId) {
  return prisma.contract_additive_services.deleteMany({
    where: { additive_id: additiveId },
  });
}

/**
 * Aprova aditivo em transação:
 * 1. Atualiza status/approved_by/approved_at do aditivo.
 * 2. Para cada item em contract_additive_services:
 *    - Se quantity_change: soma a quantity_change à quantity atual do contract_service.
 *    - Se new_unit_price:  atualiza unit_price do contract_service.
 *    - Se o serviço não existir no contrato ainda (adição de novo serviço): cria o contract_service.
 */
async function approveTransaction(additiveId, approverId) {
  return prisma.$transaction(async (tx) => {
    // 1. Buscar o aditivo e seus itens
    const additive = await tx.contract_additives.findUnique({
      where: { id: additiveId },
      include: { contract_additive_services: true },
    });

    // 2. Processar cada item
    for (const item of additive.contract_additive_services) {
      const existing = await tx.contract_services.findFirst({
        where: {
          contract_id: additive.contract_id,
          service_id:  item.service_id,
          active:      true,
        },
      });

      if (existing) {
        // Serviço já existe — atualizar
        const updateData = {};
        if (item.quantity_change !== null) {
          // delta: soma ao valor atual
          const { Prisma } = require('@prisma/client');
          updateData.quantity = new Prisma.Decimal(existing.quantity).add(item.quantity_change);
        }
        if (item.new_unit_price !== null) {
          updateData.unit_price = item.new_unit_price;
        }
        if (Object.keys(updateData).length > 0) {
          await tx.contract_services.update({
            where: { id: existing.id },
            data:  updateData,
          });
        }
      } else {
        // Serviço novo — criar no contrato
        // Para adição via aditivo: quantity_change é a quantidade inicial; new_unit_price é o preço
        await tx.contract_services.create({
          data: {
            contract_id: additive.contract_id,
            service_id:  item.service_id,
            quantity:    item.quantity_change ?? 0,
            unit_price:  item.new_unit_price  ?? 0,
            active:      true,
          },
        });
      }
    }

    // 3. Marcar aditivo como APPROVED
    return tx.contract_additives.update({
      where: { id: additiveId },
      data: {
        status:      'APPROVED',
        approved_by: approverId,
        approved_at: new Date(),
      },
    });
  });
}

module.exports = {
  list,
  findById,
  create,
  update,
  nextVersionNumber,
  addServices,
  clearServices,
  approveTransaction,
};
