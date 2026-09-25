'use strict';

/**
 * Repository de Serviços
 *
 * Referência: Documento 2 — seção 7
 *             Documento 3 — §15 (services)
 *
 * Responsabilidade: isolar operações de persistência.
 * NÃO decide regras de negócio.
 */

const prisma = require('../../config/prisma');

const SERVICE_SELECT = {
  id:          true,
  code:        true,
  name:        true,
  unit:        true,
  requires_al: true,
  active:      true,
  created_at:  true,
  updated_at:  true,
};

async function findById(id) {
  return prisma.services.findUnique({ where: { id }, select: SERVICE_SELECT });
}

async function findByCode(code) {
  return prisma.services.findUnique({ where: { code }, select: SERVICE_SELECT });
}

/**
 * Lista serviços com filtros e paginação.
 * `serviceIds` null = sem restrição; array = filtrar por esses IDs (para CONTRACTOR).
 */
async function findMany({ name, code, unit, active, serviceIds, page = 1, limit = 20 } = {}) {
  const where = {};

  if (name)             where.name   = { contains: name, mode: 'insensitive' };
  if (code)             where.code   = { contains: code, mode: 'insensitive' };
  if (unit)             where.unit   = unit;
  if (active !== undefined) where.active = active;

  if (serviceIds !== null && serviceIds !== undefined) {
    where.id = { in: serviceIds };
  }

  const skip = (page - 1) * limit;
  const take = limit;

  const [data, total] = await prisma.$transaction([
    prisma.services.findMany({ where, select: SERVICE_SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.services.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function create({ code, name, unit, requires_al }) {
  return prisma.services.create({
    data: { code: code.trim().toUpperCase(), name: name.trim(), unit, requires_al: requires_al ?? false },
    select: SERVICE_SELECT,
  });
}

async function update(id, data) {
  const updateData = {};
  if (data.code        !== undefined) updateData.code        = data.code.trim().toUpperCase();
  if (data.name        !== undefined) updateData.name        = data.name.trim();
  if (data.unit        !== undefined) updateData.unit        = data.unit;
  if (data.requires_al !== undefined) updateData.requires_al = data.requires_al;

  return prisma.services.update({ where: { id }, data: updateData, select: SERVICE_SELECT });
}

async function setStatus(id, active) {
  return prisma.services.update({ where: { id }, data: { active }, select: SERVICE_SELECT });
}

/**
 * IDs dos serviços presentes nos contratos de um empreiteiro.
 * Usado para filtrar a listagem para o perfil CONTRACTOR (Doc5 §11).
 *
 * P-08 (pendência): o critério de "serviço disponível" para o Empreiteiro não está
 * explicitamente definido nos documentos. Por ora, retorna serviços de QUALQUER contrato
 * do empreiteiro (independente de status do contrato).
 * A definição final do que "disponível" significa será feita na Etapa de Contratos.
 */
async function getServiceIdsByContractorId(contractorId) {
  if (!contractorId) return [];
  const rows = await prisma.contract_services.findMany({
    where:  { contract: { contractor_id: contractorId }, active: true },
    select: { service_id: true },
  });
  return [...new Set(rows.map(r => r.service_id))];
}

module.exports = { findById, findByCode, findMany, create, update, setStatus, getServiceIdsByContractorId };
