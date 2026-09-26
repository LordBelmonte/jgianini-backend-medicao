'use strict';
const prisma = require('../../config/prisma');

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITÓRIO DE CONTRATOS
// Responsável apenas por operações de banco, SEM regras de negócio.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista contratos com filtragem contextual.
 * Admin/Director: veem todos.
 * Coordinator/Fiscal/Responsible: veem contratos das obras vinculadas.
 * Contractor: veem somente seus próprios contratos.
 */
async function list({ page = 1, limit = 100, actor, workId, contractorId }) {
  const skip = (page - 1) * limit;

  // Admin e Director veem todos
  const isAdminOrDirector = actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR');

  const where = {};

  // Filter by work if provided
  if (workId) {
    where.work_id = workId;
  }

  // Filter by contractor if provided
  if (contractorId) {
    where.contractor_id = contractorId;
  }

  // Se não for Admin/Director, aplicar filtros contextuais
  if (!isAdminOrDirector) {
    // CONTRACTOR: apenas seus contratos
    if (actor.roles.includes('CONTRACTOR')) {
      where.contractor_id = actor.contractor_id;
    } else {
      // Coordinator, Fiscal, Responsible: contratos das obras vinculadas
      const userWorks = await prisma.user_works.findMany({
        where: { user_id: actor.id },
        select: { work_id: true },
      });
      const workIds = userWorks.map(uw => uw.work_id);
      if (workIds.length > 0) {
        where.work_id = { in: workIds };
      } else {
        // Não está vinculado a nenhuma obra → retorna vazio
        where.work_id = null; // Resultará em array vazio
      }
    }
  }

  const [total, items] = await Promise.all([
    prisma.contracts.count({ where }),
    prisma.contracts.findMany({
      where,
      include: {
        work: {
          select: { id: true, name: true, code: true },
        },
        contractor: {
          select: { id: true, name: true, document: true },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [{ created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Busca contrato por ID com controle de acesso.
 */
async function findById(id, actor) {
  const contract = await prisma.contracts.findUnique({
    where: { id },
    include: {
      work: {
        select: { id: true, name: true, code: true },
      },
      contractor: {
        select: { id: true, name: true, document: true },
      },
      creator: {
        select: { id: true, name: true, email: true },
      },
      contract_services: {
        where: { active: true },
        select: {
          id: true,
          service: {
            select: { id: true, code: true, name: true, unit: true },
          },
          quantity: true,
          unit_price: true,
          created_at: true,
        },
      },
    },
  });

  if (!contract) {
    return null;
  }

  // Admin/Director: acesso total
  const isAdminOrDirector = actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR');

  // CONTRACTOR: pode ver apenas seus contratos
  if (actor.roles.includes('CONTRACTOR')) {
    if (contract.contractor_id !== actor.contractor_id) {
      return null;
    }
  }
  // Coordinator, Fiscal, Responsible: precisa estar vinculado à obra do contrato
  else if (!isAdminOrDirector) {
    const userWork = await prisma.user_works.findFirst({
      where: { user_id: actor.id, work_id: contract.work_id },
    });
    if (!userWork) {
      return null;
    }
  }

  return contract;
}

/**
 * Cria contrato.
 */
async function create(data) {
  return prisma.contracts.create({
    data,
    include: {
      work: {
        select: { id: true, name: true, code: true },
      },
      contractor: {
        select: { id: true, name: true, document: true },
      },
      creator: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Atualiza dados administrativos do contrato (notes, dates, retention, etc.).
 */
async function update(id, data) {
  return prisma.contracts.update({
    where: { id },
    data,
    include: {
      work: {
        select: { id: true, name: true, code: true },
      },
      contractor: {
        select: { id: true, name: true, document: true },
      },
      creator: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Atualiza status do contrato.
 */
async function updateStatus(id, status) {
  return prisma.contracts.update({
    where: { id },
    data: { status },
  });
}

/**
 * Verifica se contract_number já existe na mesma obra.
 */
async function contractNumberExists(workId, contractNumber) {
  const existing = await prisma.contracts.findFirst({
    where: {
      work_id: workId,
      contract_number: contractNumber,
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Adiciona serviço ao contrato.
 */
async function addService(contractId, serviceData) {
  return prisma.contract_services.create({
    data: {
      contract_id: contractId,
      ...serviceData,
    },
  });
}

/**
 * Atualiza serviço do contrato.
 */
async function updateService(serviceId, data) {
  return prisma.contract_services.update({
    where: { id: serviceId },
    data,
  });
}

/**
 * Remove (soft-delete) serviço do contrato.
 */
async function removeService(serviceId) {
  return prisma.contract_services.update({
    where: { id: serviceId },
    data: { active: false },
  });
}

/**
 * Busca serviço vinculado ao contrato.
 */
async function findServiceById(serviceId) {
  return prisma.contract_services.findUnique({
    where: { id: serviceId },
    include: {
      contract: {
        select: { id: true, work_id: true, contractor_id: true, status: true },
      },
      service: {
        select: { id: true, code: true, name: true, unit: true },
      },
    },
  });
}

/**
 * Lista serviços ativos do contrato.
 */
async function listContractServices(contractId) {
  return prisma.contract_services.findMany({
    where: {
      contract_id: contractId,
      active: true,
    },
    include: {
      service: {
        select: { id: true, code: true, name: true, unit: true },
      },
    },
    orderBy: [{ created_at: 'asc' }],
  });
}

/**
 * Calcula o saldo contratual por serviço.
 * Retorna: quantidade contratada, valor contratado.
 * O consumo real será calculado nos módulos de Medições futuros.
 */
async function calculateBalance(contractId) {
  const services = await prisma.contract_services.findMany({
    where: {
      contract_id: contractId,
      active: true,
    },
    select: {
      id: true,
      service_id: true,
      quantity: true,
      unit_price: true,
      service: {
        select: {
          code: true,
          name: true,
          unit: true,
        },
      },
    },
  });

  return services.map(s => ({
    service_id: s.service_id,
    service_code: s.service.code,
    service_name: s.service.name,
    unit: s.service.unit,
    quantity_contracted: s.quantity,
    unit_price: s.unit_price,
    value_contracted: s.quantity.mul(s.unit_price).toNumber(),
    consumed_quantity: 0,      // Será preenchido pelo módulo Medições
    consumed_value: 0,         // Será preenchido pelo módulo Medições
    balance_quantity: s.quantity, // Por enquanto, saldo = contratado (consumo = 0)
    balance_value: s.quantity.mul(s.unit_price).toNumber(),
  }));
}

module.exports = {
  list,
  findById,
  create,
  update,
  updateStatus,
  contractNumberExists,
  addService,
  updateService,
  removeService,
  findServiceById,
  listContractServices,
  calculateBalance,
};