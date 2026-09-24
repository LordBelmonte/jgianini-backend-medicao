'use strict';

/**
 * SEED — Dados técnicos de referência
 * Sistema de Medicao e Pagamento — Jgianini Esquadrias de Aluminio
 *
 * Referências:
 *   Doc3 §7  — Perfis/Roles
 *   Doc3 §8  — Permissões
 *   Doc3 §32 — Motivos de retrabalho
 *   Doc5 §3  — Perfis oficiais
 *   Doc5 §38 — Permissões granulares
 *   Doc5 §27 — Motivos de retrabalho (confirmação)
 *
 * REGRA: Somente dados técnicos de referência.
 * NÃO inserir dados reais de produção (usuários, obras, empreiteiros, etc.)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// PERFIS — Doc5 §3, Doc3 §7
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = [
  {
    name: 'ADMIN',
    description: 'Administrador — administracao tecnica e cadastral do sistema',
  },
  {
    name: 'DIRECTOR',
    description: 'Diretor — etapa final de validacao e aprovacao',
  },
  {
    name: 'COORDINATOR',
    description: 'Coordenador — coordenacao operacional e validacao antes do Diretor',
  },
  {
    name: 'FISCAL',
    description: 'Fiscal — conferencia operacional da medicao',
  },
  {
    name: 'RESPONSIBLE',
    description: 'Responsavel — etapa intermediaria de aprovacao',
  },
  {
    name: 'CONTRACTOR',
    description: 'Empreiteiro — inicia e acompanha medicoes',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSÕES GRANULARES — Doc5 §38
// ─────────────────────────────────────────────────────────────────────────────
const PERMISSIONS = [
  // Usuários
  { code: 'users.view',    description: 'Visualizar usuarios' },
  { code: 'users.create',  description: 'Criar usuarios' },
  { code: 'users.update',  description: 'Atualizar usuarios' },
  { code: 'users.disable', description: 'Ativar/desativar usuarios' },

  // Obras
  { code: 'works.view',    description: 'Visualizar obras' },
  { code: 'works.create',  description: 'Criar obras' },
  { code: 'works.update',  description: 'Atualizar obras' },

  // Empreiteiros
  { code: 'contractors.view',   description: 'Visualizar empreiteiros' },
  { code: 'contractors.create', description: 'Criar empreiteiros' },
  { code: 'contractors.update', description: 'Atualizar empreiteiros' },

  // Serviços
  { code: 'services.view',   description: 'Visualizar servicos' },
  { code: 'services.create', description: 'Criar servicos' },
  { code: 'services.update', description: 'Atualizar servicos' },

  // Contratos
  { code: 'contracts.view',   description: 'Visualizar contratos' },
  { code: 'contracts.create', description: 'Criar contratos' },
  { code: 'contracts.update', description: 'Atualizar contratos' },

  // Aditivos
  { code: 'additives.view',    description: 'Visualizar aditivos' },
  { code: 'additives.create',  description: 'Criar aditivos' },
  { code: 'additives.approve', description: 'Aprovar aditivos' },
  { code: 'additives.reject',  description: 'Rejeitar aditivos' },

  // ALs
  { code: 'als.view',    description: 'Visualizar ALs' },
  { code: 'als.import',  description: 'Importar ALs' },
  { code: 'als.approve', description: 'Aprovar ALs' },
  { code: 'als.link',    description: 'Vincular AL a empreiteiro' },

  // Medições
  { code: 'measurements.view',           description: 'Visualizar medicoes' },
  { code: 'measurements.create',         description: 'Criar medicoes' },
  { code: 'measurements.update',         description: 'Atualizar medicoes' },
  { code: 'measurements.submit',         description: 'Enviar medicao' },
  { code: 'measurements.return',         description: 'Devolver medicao' },
  { code: 'measurements.approve',        description: 'Aprovar medicao' },
  { code: 'measurements.contest',        description: 'Contestar decisao do Fiscal' },
  { code: 'measurements.resolve_contest',description: 'Resolver contestacao' },
  { code: 'measurements.cancel',         description: 'Cancelar medicao — RESPONSIBLE/COORDINATOR/DIRECTOR apenas (D-02)' },

  // Pagamentos
  { code: 'payments.view',   description: 'Visualizar pagamentos' },
  { code: 'payments.create', description: 'Registrar pagamentos' },
  { code: 'payments.cancel', description: 'Cancelar pagamentos' },

  // Documentos
  { code: 'documents.view',   description: 'Visualizar documentos' },
  { code: 'documents.upload', description: 'Fazer upload de documentos' },

  // Auditoria e relatórios
  { code: 'audit.view',   description: 'Consultar auditoria' },
  { code: 'reports.view', description: 'Acessar relatorios' },
];

// ─────────────────────────────────────────────────────────────────────────────
// MOTIVOS DE RETRABALHO — Doc3 §32, Doc5 §27, Doc7 §37
// ─────────────────────────────────────────────────────────────────────────────
const REWORK_REASONS = [
  {
    code: 'ENGINEERING_FAILURE',
    description: 'Falha da engenharia da obra',
  },
  {
    code: 'MANUFACTURING_FAILURE',
    description: 'Falha na fabricacao',
  },
  {
    code: 'SIZE_LARGER_THAN_OPENING',
    description: 'Tamanho maior que o vao de instalacao',
  },
  {
    code: 'SIZE_SMALLER_THAN_OPENING',
    description: 'Tamanho menor que o vao de instalacao',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[SEED] Iniciando seed de dados tecnicos de referencia...');

  // 1. Perfis
  console.log('[SEED] Criando perfis...');
  for (const role of ROLES) {
    await prisma.roles.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  const rolesCount = await prisma.roles.count();
  console.log(`[SEED] Perfis: ${rolesCount} registros`);

  // 2. Permissões
  console.log('[SEED] Criando permissoes...');
  for (const permission of PERMISSIONS) {
    await prisma.permissions.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: permission,
    });
  }
  const permissionsCount = await prisma.permissions.count();
  console.log(`[SEED] Permissoes: ${permissionsCount} registros`);

  // 3. Motivos de retrabalho
  console.log('[SEED] Criando motivos de retrabalho...');
  for (const reason of REWORK_REASONS) {
    await prisma.rework_reasons.upsert({
      where: { code: reason.code },
      update: { description: reason.description },
      create: reason,
    });
  }
  const reasonsCount = await prisma.rework_reasons.count();
  console.log(`[SEED] Motivos de retrabalho: ${reasonsCount} registros`);

  console.log('[SEED] Seed concluido com sucesso.');
  console.log(`[SEED] Resumo: ${rolesCount} perfis | ${permissionsCount} permissoes | ${reasonsCount} motivos de retrabalho`);
}

main()
  .catch((err) => {
    console.error('[SEED] Erro durante o seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
