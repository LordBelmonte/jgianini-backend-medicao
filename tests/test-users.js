'use strict';

/**
 * Testes da Etapa 4 — Módulo de Usuários
 *
 * Cenários:
 *   T01 — Sem token → 401
 *   T02 — Sem permissão → 403
 *   T03 — Admin cria usuário válido → 201
 *   T04 — Admin cria com email duplicado → 409
 *   T05 — Admin cria sem nome → 400
 *   T06 — Admin cria sem email → 400
 *   T07 — Admin cria com email inválido → 400
 *   T08 — Admin cria com senha fraca → 400 (P-01)
 *   T09 — Admin cria com roleIds válidos → perfis vinculados
 *   T10 — Admin cria com roleId inexistente → 422
 *   T11 — Admin lista usuários → 200 + paginação
 *   T12 — Admin busca por ID → 200
 *   T13 — Admin busca ID inexistente → 404
 *   T14 — Admin atualiza nome → 200
 *   T15 — Admin atualiza email duplicado → 409
 *   T16 — Admin atualiza com senha fraca → 400
 *   T17 — Admin desativa usuário → active=false
 *   T18 — Admin ativa usuário → active=true
 *   T19 — Desativar usuário já inativo → 409
 *   T20 — Usuário desativado não consegue autenticar → 401
 *   T21 — Empreiteiro vê somente os próprios dados
 *   T22 — Empreiteiro não pode criar usuário → 403
 *   T23 — Auditoria registrada na criação
 *   T24 — Auditoria registrada na atualização
 *   T25 — Auditoria registrada na desativação
 *   T26 — password_hash nunca retornado na resposta
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

// ─── helpers ─────────────────────────────────────────────────────────────────

let server, port;
let adminUserId, adminToken;
let contractorUserId, contractorToken;
let adminRoleId;
let contractorRoleId;
let createdUserId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token  ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`FALHOU: ${message}`);
}

// ─── setup ────────────────────────────────────────────────────────────────────

async function setup() {
  // Buscar IDs dos perfis do seed
  const adminRole      = await prisma.roles.findUnique({ where: { name: 'ADMIN' } });
  const contractorRole = await prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } });
  adminRoleId      = adminRole.id;
  contractorRoleId = contractorRole.id;

  // Buscar permissões necessárias
  const perms = await prisma.permissions.findMany({
    where: { code: { in: ['users.view','users.create','users.update','users.disable'] } },
  });

  // Vincular permissões ao perfil ADMIN (se ainda não vinculadas)
  for (const perm of perms) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {},
      create: { role_id: adminRoleId, permission_id: perm.id },
    });
  }

  // Vincular users.view ao CONTRACTOR (Doc5 §8: empreiteiro pode consultar os próprios dados)
  const viewPerm = perms.find(p => p.code === 'users.view');
  await prisma.role_permissions.upsert({
    where:  { role_id_permission_id: { role_id: contractorRoleId, permission_id: viewPerm.id } },
    update: {},
    create: { role_id: contractorRoleId, permission_id: viewPerm.id },
  });

  // Criar usuário admin de teste
  const hash = await bcrypt.hash('Admin@Teste123', 12);
  const admin = await prisma.users.create({
    data: { name: '__TEST_ADMIN__', email: 'admin@users.test', password_hash: hash, active: true },
  });
  adminUserId = admin.id;
  await prisma.user_roles.create({ data: { user_id: adminUserId, role_id: adminRoleId } });

  // Criar usuário empreiteiro de teste
  const hashC = await bcrypt.hash('Cont@Teste123', 12);
  const contractor = await prisma.users.create({
    data: { name: '__TEST_CONTRACTOR__', email: 'contractor@users.test', password_hash: hashC, active: true },
  });
  contractorUserId = contractor.id;
  await prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId } });

  // Iniciar servidor
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  // Obter tokens
  const resAdmin = await request('POST', '/api/auth/login',
    { email: 'admin@users.test', password: 'Admin@Teste123' });
  adminToken = resAdmin.body.data.token;

  const resCont = await request('POST', '/api/auth/login',
    { email: 'contractor@users.test', password: 'Cont@Teste123' });
  contractorToken = resCont.body.data.token;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  const ids = [adminUserId, contractorUserId, createdUserId].filter(Boolean);

  // Remover vínculos e usuários de teste
  if (ids.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  }

  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 4: USUÁRIOS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (err) { console.log(`  ❌  ${label}\n       → ${err.message}`); failed++; }
  }

  // T01 — sem token
  await test('T01 — Sem token → 401', async () => {
    const res = await request('GET', '/api/users');
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
  });

  // T02 — sem permissão (empreiteiro tentando criar)
  await test('T02 — Empreiteiro tenta criar usuário → 403', async () => {
    const res = await request('POST', '/api/users',
      { name: 'X', email: 'x@x.com', password: 'Abc@1234' }, contractorToken);
    assert(res.status === 403, `esperado 403, recebido ${res.status}`);
    assert(res.body.error.code === 'FORBIDDEN', `code: ${res.body.error.code}`);
  });

  // T03 — admin cria usuário válido
  await test('T03 — Admin cria usuário válido → 201', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Novo Usuário', email: 'novo@users.test', password: 'Novo@Teste123' },
      adminToken);
    assert(res.status === 201, `esperado 201, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
    assert(res.body.data.email === 'novo@users.test', 'email incorreto');
    assert(res.body.data.active === true, 'deve estar ativo');
    assert(!res.body.data.password_hash, 'password_hash NÃO deve ser retornado');
    createdUserId = res.body.data.id;
  });

  // T04 — email duplicado
  await test('T04 — Admin cria com email duplicado → 409', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Duplicado', email: 'novo@users.test', password: 'Novo@Teste123' },
      adminToken);
    assert(res.status === 409, `esperado 409, recebido ${res.status}`);
    assert(res.body.error.code === 'EMAIL_ALREADY_EXISTS', `code: ${res.body.error.code}`);
  });

  // T05 — sem nome
  await test('T05 — Admin cria sem nome → 400', async () => {
    const res = await request('POST', '/api/users',
      { email: 'sem@nome.test', password: 'Sem@Nome123' }, adminToken);
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `code: ${res.body.error.code}`);
  });

  // T06 — sem email
  await test('T06 — Admin cria sem email → 400', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Sem Email', password: 'Sem@Email123' }, adminToken);
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
  });

  // T07 — email inválido
  await test('T07 — Admin cria com email inválido → 400', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Email Inválido', email: 'nao-e-email', password: 'Email@123' }, adminToken);
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
  });

  // T08 — senha fraca (P-01)
  await test('T08 — Admin cria com senha fraca → 400 (P-01)', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Senha Fraca', email: 'fraca@users.test', password: '123456' }, adminToken);
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `code: ${res.body.error.code}`);
  });

  // T09 — criar com roleIds válidos
  await test('T09 — Admin cria usuário com roleId válido → perfil vinculado', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Com Role', email: 'comrole@users.test', password: 'Role@Teste123',
        roleIds: [contractorRoleId] },
      adminToken);
    assert(res.status === 201, `esperado 201, recebido ${res.status}`);
    assert(Array.isArray(res.body.data.roles), 'roles deve ser array');
    assert(res.body.data.roles.length === 1, `esperado 1 role, recebido ${res.body.data.roles.length}`);
    assert(res.body.data.roles[0].name === 'CONTRACTOR', `role incorreto: ${res.body.data.roles[0].name}`);
    // Limpar
    await prisma.user_roles.deleteMany({ where: { user_id: res.body.data.id } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: res.body.data.id } });
    await prisma.users.delete({ where: { id: res.body.data.id } });
  });

  // T10 — roleId inexistente
  await test('T10 — Admin cria com roleId inexistente → 422', async () => {
    const res = await request('POST', '/api/users',
      { name: 'Role Inex', email: 'roleinex@users.test', password: 'Role@Inex123',
        roleIds: ['00000000-0000-0000-0000-000000000000'] },
      adminToken);
    assert(res.status === 422, `esperado 422, recebido ${res.status}`);
    assert(res.body.error.code === 'ROLE_NOT_FOUND', `code: ${res.body.error.code}`);
  });

  // T11 — listar usuários
  await test('T11 — Admin lista usuários → 200 + paginação', async () => {
    const res = await request('GET', '/api/users?page=1&limit=10', null, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
    assert(Array.isArray(res.body.data), 'data deve ser array');
    assert(res.body.pagination, 'paginação deve estar presente');
    assert(typeof res.body.pagination.total === 'number', 'total deve ser número');
  });

  // T12 — buscar por ID
  await test('T12 — Admin busca usuário por ID → 200', async () => {
    assert(createdUserId, 'createdUserId não definido (T03 falhou?)');
    const res = await request('GET', `/api/users/${createdUserId}`, null, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.data.id === createdUserId, 'id incorreto');
    assert(!res.body.data.password_hash, 'password_hash NÃO deve ser retornado');
  });

  // T13 — ID inexistente
  await test('T13 — Admin busca ID inexistente → 404', async () => {
    const res = await request('GET', '/api/users/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(res.status === 404, `esperado 404, recebido ${res.status}`);
    assert(res.body.error.code === 'USER_NOT_FOUND', `code: ${res.body.error.code}`);
  });

  // T14 — atualizar nome
  await test('T14 — Admin atualiza nome → 200', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const res = await request('PATCH', `/api/users/${createdUserId}`,
      { name: 'Nome Atualizado' }, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.data.name === 'Nome Atualizado', `nome: ${res.body.data.name}`);
  });

  // T15 — atualizar email duplicado
  await test('T15 — Admin atualiza email para duplicado → 409', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const res = await request('PATCH', `/api/users/${createdUserId}`,
      { email: 'admin@users.test' }, adminToken);
    assert(res.status === 409, `esperado 409, recebido ${res.status}`);
    assert(res.body.error.code === 'EMAIL_ALREADY_EXISTS', `code: ${res.body.error.code}`);
  });

  // T16 — atualizar com senha fraca
  await test('T16 — Admin atualiza com senha fraca → 400 (P-01)', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const res = await request('PATCH', `/api/users/${createdUserId}`,
      { password: 'fraca' }, adminToken);
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
  });

  // T17 — desativar usuário
  await test('T17 — Admin desativa usuário → active=false', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const res = await request('PATCH', `/api/users/${createdUserId}/status`,
      { active: false }, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.data.active === false, 'deve estar inativo');
  });

  // T18 — ativar usuário
  await test('T18 — Admin ativa usuário → active=true', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const res = await request('PATCH', `/api/users/${createdUserId}/status`,
      { active: true }, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.data.active === true, 'deve estar ativo');
  });

  // T19 — desativar já inativo
  await test('T19 — Desativar usuário já ativo novamente → 409 se mesmo status', async () => {
    assert(createdUserId, 'createdUserId não definido');
    // Usuário está ativo (T18 ativou). Tentar ativar novamente → 409
    const res = await request('PATCH', `/api/users/${createdUserId}/status`,
      { active: true }, adminToken);
    assert(res.status === 409, `esperado 409, recebido ${res.status}`);
    assert(res.body.error.code === 'STATUS_UNCHANGED', `code: ${res.body.error.code}`);
  });

  // T20 — usuário desativado não autentica
  await test('T20 — Usuário desativado não consegue autenticar → 401', async () => {
    assert(createdUserId, 'createdUserId não definido');
    // Desativar
    await request('PATCH', `/api/users/${createdUserId}/status`, { active: false }, adminToken);
    // Tentar login
    const res = await request('POST', '/api/auth/login',
      { email: 'novo@users.test', password: 'Novo@Teste123' });
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.error.code === 'USER_INACTIVE', `code: ${res.body.error.code}`);
    // Reativar para limpeza posterior
    await request('PATCH', `/api/users/${createdUserId}/status`, { active: true }, adminToken);
  });

  // T21 — empreiteiro vê somente seus dados
  await test('T21 — Empreiteiro lista usuários → vê somente o próprio', async () => {
    const res = await request('GET', '/api/users', null, contractorToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.data.length === 1, `esperado 1 resultado, recebido ${res.body.data.length}`);
    assert(res.body.data[0].id === contractorUserId, 'deve ser o próprio usuário');
  });

  // T22 — empreiteiro não pode criar
  await test('T22 — Empreiteiro tenta criar usuário → 403', async () => {
    const res = await request('POST', '/api/users',
      { name: 'X', email: 'x@y.com', password: 'Abc@1234' }, contractorToken);
    assert(res.status === 403, `esperado 403, recebido ${res.status}`);
  });

  // T23 — auditoria na criação
  await test('T23 — Criação registrada na auditoria', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const log = await prisma.audit_logs.findFirst({
      where: { entity_type: 'user', entity_id: createdUserId, action: 'CREATE_USER' },
    });
    assert(log !== null, 'registro de auditoria CREATE_USER não encontrado');
    assert(log.user_id === adminUserId, 'actor incorreto na auditoria');
  });

  // T24 — auditoria na atualização
  await test('T24 — Atualização registrada na auditoria', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const log = await prisma.audit_logs.findFirst({
      where: { entity_type: 'user', entity_id: createdUserId, action: 'UPDATE_USER' },
    });
    assert(log !== null, 'registro de auditoria UPDATE_USER não encontrado');
    assert(log.old_values !== null, 'old_values deve estar presente');
    assert(log.new_values !== null, 'new_values deve estar presente');
  });

  // T25 — auditoria na desativação
  await test('T25 — Desativação registrada na auditoria', async () => {
    assert(createdUserId, 'createdUserId não definido');
    const log = await prisma.audit_logs.findFirst({
      where: { entity_type: 'user', entity_id: createdUserId, action: 'DISABLE_USER' },
    });
    assert(log !== null, 'registro de auditoria DISABLE_USER não encontrado');
  });

  // T26 — password_hash nunca retornado
  await test('T26 — password_hash nunca retornado na listagem', async () => {
    const res = await request('GET', '/api/users', null, adminToken);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    for (const u of res.body.data) {
      assert(!u.password_hash, `password_hash exposto para usuário ${u.id}`);
    }
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

// ─── execução ────────────────────────────────────────────────────────────────

(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('ERRO FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await teardown();
  }
})();
