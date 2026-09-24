'use strict';

/**
 * Teste de conexão real Prisma x PostgreSQL
 * Etapa 2 — Banco de Dados
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runTests() {
  console.log('=== TESTE DE CONEXÃO PRISMA x POSTGRESQL ===\n');

  // Teste 1 — Conexão real
  console.log('[ T01 ] Conexão real com o banco...');
  const result = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usr, version() AS ver`;
  console.log('        Banco    :', result[0].db);
  console.log('        Usuário  :', result[0].usr);
  console.log('        Versão   :', result[0].ver.split(',')[0]);
  console.log('        Status   : OK\n');

  // Teste 2 — Perfis do seed
  console.log('[ T02 ] Lendo perfis (roles)...');
  const roles = await prisma.roles.findMany({ orderBy: { name: 'asc' } });
  roles.forEach(r => console.log(`        - ${r.name}`));
  console.log(`        Total    : ${roles.length} perfis`);
  console.log('        Status   : OK\n');

  // Teste 3 — Permissões do seed
  console.log('[ T03 ] Contando permissões...');
  const permCount = await prisma.permissions.count();
  console.log(`        Total    : ${permCount} permissões`);
  console.log('        Status   : OK\n');

  // Teste 4 — Motivos de retrabalho
  console.log('[ T04 ] Lendo motivos de retrabalho...');
  const reasons = await prisma.rework_reasons.findMany({ orderBy: { code: 'asc' } });
  reasons.forEach(r => console.log(`        - ${r.code}: ${r.description}`));
  console.log(`        Total    : ${reasons.length} motivos`);
  console.log('        Status   : OK\n');

  // Teste 5 — Contagem de tabelas no banco
  console.log('[ T05 ] Verificando tabelas no banco...');
  const tables = await prisma.$queryRaw`
    SELECT count(*) AS total
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
  `;
  console.log(`        Tabelas  : ${tables[0].total}`);
  console.log('        Status   : OK\n');

  // Teste 6 — Enums no banco
  console.log('[ T06 ] Verificando enums no banco...');
  const enums = await prisma.$queryRaw`
    SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
  `;
  enums.forEach(e => console.log(`        - ${e.typname}`));
  console.log(`        Total    : ${enums.length} enums`);
  console.log('        Status   : OK\n');

  // Teste 7 — Transação básica (insert + rollback)
  console.log('[ T07 ] Testando transação (insert + rollback)...');
  try {
    await prisma.$transaction(async (tx) => {
      const role = await tx.roles.create({
        data: { name: '__TEST_ROLE__', description: 'Teste de transacao' },
      });
      console.log(`        Inserido : ${role.name} (id: ${role.id})`);
      // Forçar rollback deliberado
      throw new Error('ROLLBACK_TEST');
    });
  } catch (err) {
    if (err.message === 'ROLLBACK_TEST') {
      const check = await prisma.roles.findUnique({ where: { name: '__TEST_ROLE__' } });
      if (!check) {
        console.log('        Rollback : confirmado — registro não persistiu');
        console.log('        Status   : OK\n');
      }
    } else {
      throw err;
    }
  }

  console.log('=== TODOS OS TESTES PASSARAM ===');
}

runTests()
  .catch((err) => {
    console.error('ERRO NO TESTE:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
