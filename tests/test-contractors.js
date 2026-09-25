'use strict';

/**
 * Testes da Etapa 6 — Módulo de Empreiteiros
 *
 * T01  Sem token → 401
 * T02  Admin cria empreiteiro válido (sem document) → 201
 * T03  Admin cria com document → 201
 * T04  Admin cria com document duplicado → 409
 * T05  Coordinator cria empreiteiro → 201
 * T06  Fiscal tenta criar → 403
 * T07  Admin cria sem nome → 400
 * T08  Dois empreiteiros com document = null → permitido
 * T09  Admin lista todos → 200
 * T10  Fiscal sem obra vinculada lista → lista vazia
 * T11  Fiscal com obra vinculada → vê somente empreiteiros da obra
 * T12  Admin busca por ID → 200
 * T13  Fiscal busca empreiteiro fora de sua obra → 403
 * T14  ID inexistente → 404
 * T15  Admin atualiza nome → 200
 * T16  Admin atualiza document para duplicado → 409
 * T17  Admin inativa empreiteiro → active=false
 * T18  Admin ativa empreiteiro → active=true
 * T19  Inativar já inativo → 409
 * T20  Admin consulta obras de um empreiteiro → 200
 * T21  Fiscal consulta obras de empreiteiro → somente as suas obras
 * T22  Empreiteiro inexistente em /works → 404
 * T23  email inválido na criação → 400
 * T24  Criação auditada
 * T25  Atualização auditada (old/new values)
 * T26  Inativação auditada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

// ─── helpers ─────────────────────────────────────────────────────────────────

let server, port;
let adminToken, coordToken, fiscalToken;
let adminId, coordId, fiscalId;
let adminRoleId, coordRoleId, fiscalRoleId;
let testWorkId;
let createdContractorId, contractor2Id;

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

// ─── setup ───────────────────────────────────────────────────────────────────

async function setup() {
  const [adminRole, coordRole, fiscalRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'FISCAL' } }),
  ]);
  adminRoleId = adminRole.id;
  coordRoleId = coordRole.id;
  fiscalRoleId = fiscalRole.id;

  // Permissões de empreiteiros
  const permCodes = ['contractors.view', 'contractors.create', 'contractors.update'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: perm.id },
    });
  }
  for (const perm of perms.filter(p => p.code !== 'contractors.update' || true)) {
    if (perm.code === 'contractors.view' || perm.code === 'contractors.create' || perm.code === 'contractors.update') {
      await prisma.role_permissions.upsert({
        where:  { role_id_permission_id: { role_id: coordRoleId, permission_id: perm.id } },
        update: {}, create: { role_id: coordRoleId, permission_id: perm.id },
      });
    }
  }
  const viewPerm = perms.find(p => p.code === 'contractors.view');
  await prisma.role_permissions.upsert({
    where:  { role_id_permission_id: { role_id: fiscalRoleId, permission_id: viewPerm.id } },
    update: {}, create: { role_id: fiscalRoleId, permission_id: viewPerm.id },
  });

  // Obras também precisam de permissão no works.view para o fiscal
  const worksViewPerm = await prisma.permissions.findUnique({ where: { code: 'works.view' } });
  if (worksViewPerm) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: fiscalRoleId, permission_id: worksViewPerm.id } },
      update: {}, create: { role_id: fiscalRoleId, permission_id: worksViewPerm.id },
    });
  }

  // Criar usuários de teste
  const hash = await bcrypt.hash('Test@Contr123', 12);
  const [admin, coord, fiscal] = await Promise.all([
    prisma.users.create({ data: { name: '__CONTR_ADMIN__', email: 'cadmin@contr.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CONTR_COORD__', email: 'ccoord@contr.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CONTR_FISCAL__', email: 'cfiscal@contr.test', password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; fiscalId = fiscal.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,  role_id: adminRoleId  } }),
    prisma.user_roles.create({ data: { user_id: coordId,  role_id: coordRoleId  } }),
    prisma.user_roles.create({ data: { user_id: fiscalId, role_id: fiscalRoleId } }),
  ]);

  // Criar obra de teste
  const work = await prisma.works.create({
    data: { code: '__CTEST__W01', name: 'Obra Contr Teste', client_name: 'Cliente', status: 'ACTIVE' },
  });
  testWorkId = work.id;

  // Iniciar servidor
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  // Tokens
  const [rA, rC, rF] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'cadmin@contr.test',  password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'ccoord@contr.test',  password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'cfiscal@contr.test', password: 'Test@Contr123' }),
  ]);
  adminToken = rA.body.data.token;
  coordToken = rC.body.data.token;
  fiscalToken = rF.body.data.token;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  const ids = [adminId, coordId, fiscalId].filter(Boolean);

  // Limpar empreiteiros criados nos testes
  const testContractors = await prisma.contractors.findMany({
    where: { name: { startsWith: '__TEST_CONTR' } },
    select: { id: true },
  });
  const tcIds = testContractors.map(c => c.id);
  const allContractorIds = [...new Set([...tcIds, createdContractorId, contractor2Id].filter(Boolean))];

  if (allContractorIds.length) {
    await prisma.work_contractors.deleteMany({ where: { contractor_id: { in: allContractorIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allContractorIds } } });
    await prisma.contractors.deleteMany({ where: { id: { in: allContractorIds } } });
  }

  if (testWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: testWorkId } });
    await prisma.works.deleteMany({ where: { id: testWorkId } });
  }

  if (ids.length) {
    await prisma.user_works.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.user_roles.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  }

  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 6: EMPREITEIROS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/contractors');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Admin cria empreiteiro válido (sem document) → 201', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_CONTR_01__', phone: '11999999999' }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.name === '__TEST_CONTR_01__', 'name incorreto');
    assert(r.body.data.document === null, 'document deve ser null');
    createdContractorId = r.body.data.id;
  });

  await test('T03 — Admin cria com document informado → 201', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_CONTR_02__', document: '12.345.678/0001-90' }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.document === '12.345.678/0001-90', `document: ${r.body.data.document}`);
    contractor2Id = r.body.data.id;
  });

  await test('T04 — Admin cria com document duplicado → 409', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_CONTR_DUP__', document: '12.345.678/0001-90' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'DOCUMENT_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T05 — Coordinator cria empreiteiro → 201', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_CONTR_03__' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    // Cleanup imediato
    await prisma.audit_logs.deleteMany({ where: { entity_id: r.body.data.id } });
    await prisma.contractors.delete({ where: { id: r.body.data.id } });
  });

  await test('T06 — Fiscal tenta criar → 403', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_FISCAL_CRIAR__' }, fiscalToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T07 — Admin cria sem nome → 400', async () => {
    const r = await request('POST', '/api/contractors',
      { phone: '11888888888' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'VALIDATION_ERROR', `code: ${r.body.error.code}`);
  });

  await test('T08 — Dois empreiteiros com document null → permitido', async () => {
    // T02 já criou um com document=null; T03 criou com document informado
    // Criamos mais um com document=null
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_CONTR_NULL2__' }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.document === null, 'document deve ser null');
    await prisma.audit_logs.deleteMany({ where: { entity_id: r.body.data.id } });
    await prisma.contractors.delete({ where: { id: r.body.data.id } });
  });

  await test('T09 — Admin lista todos → 200 + paginação', async () => {
    const r = await request('GET', '/api/contractors', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.pagination, 'paginação deve estar presente');
    assert(r.body.pagination.total >= 2, 'deve ter pelo menos 2 empreiteiros');
  });

  await test('T10 — Fiscal sem obra vinculada lista → lista vazia', async () => {
    const r = await request('GET', '/api/contractors', null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.pagination.total === 0, `esperado 0, recebido ${r.body.pagination.total}`);
  });

  await test('T11 — Fiscal com obra vinculada → vê somente empreiteiros da obra', async () => {
    // Vincular fiscal e empreiteiro à obra de teste
    await prisma.user_works.create({ data: { user_id: fiscalId, work_id: testWorkId } });
    await prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: createdContractorId, active: true } });

    const r = await request('GET', '/api/contractors', null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.pagination.total === 1, `esperado 1, recebido ${r.body.pagination.total}`);
    assert(r.body.data[0].id === createdContractorId, 'deve ser o empreiteiro da obra');

    // Remover vínculos temporários
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId, contractor_id: createdContractorId } });
    await prisma.user_works.deleteMany({ where: { user_id: fiscalId, work_id: testWorkId } });
  });

  await test('T12 — Admin busca por ID → 200', async () => {
    assert(createdContractorId, 'createdContractorId não definido');
    const r = await request('GET', `/api/contractors/${createdContractorId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === createdContractorId, 'id incorreto');
  });

  await test('T13 — Fiscal busca empreiteiro fora de sua obra → 403', async () => {
    const r = await request('GET', `/api/contractors/${createdContractorId}`, null, fiscalToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T14 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/contractors/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTRACTOR_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T15 — Admin atualiza nome → 200', async () => {
    const r = await request('PATCH', `/api/contractors/${createdContractorId}`,
      { name: '__TEST_CONTR_01_UPDATED__' }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.name === '__TEST_CONTR_01_UPDATED__', `name: ${r.body.data.name}`);
  });

  await test('T16 — Admin atualiza document para duplicado → 409', async () => {
    const r = await request('PATCH', `/api/contractors/${createdContractorId}`,
      { document: '12.345.678/0001-90' }, adminToken); // document já usado no contractor2
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'DOCUMENT_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T17 — Admin inativa empreiteiro → active=false', async () => {
    const r = await request('PATCH', `/api/contractors/${createdContractorId}/status`,
      { active: false }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.active === false, 'deve estar inativo');
  });

  await test('T18 — Admin ativa empreiteiro → active=true', async () => {
    const r = await request('PATCH', `/api/contractors/${createdContractorId}/status`,
      { active: true }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.active === true, 'deve estar ativo');
  });

  await test('T19 — Inativar empreiteiro já ativo → 409 STATUS_UNCHANGED', async () => {
    const r = await request('PATCH', `/api/contractors/${createdContractorId}/status`,
      { active: true }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'STATUS_UNCHANGED', `code: ${r.body.error.code}`);
  });

  await test('T20 — Admin consulta obras de um empreiteiro → 200', async () => {
    // Vincular empreiteiro à obra de teste
    await prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: createdContractorId, active: true } });
    const r = await request('GET', `/api/contractors/${createdContractorId}/works`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.some(w => w.id === testWorkId), 'obra de teste deve estar na lista');
    // Manter vínculo para T21
  });

  await test('T21 — Fiscal consulta obras de empreiteiro → somente obras comuns', async () => {
    // Vincular fiscal à obra de teste
    await prisma.user_works.create({ data: { user_id: fiscalId, work_id: testWorkId } });
    const r = await request('GET', `/api/contractors/${createdContractorId}/works`, null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    // Fiscal vê somente obras comuns (testWorkId)
    assert(r.body.data.some(w => w.id === testWorkId), 'obra de teste deve estar na lista do fiscal');
    // Limpar vínculos
    await prisma.user_works.deleteMany({ where: { user_id: fiscalId, work_id: testWorkId } });
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId, contractor_id: createdContractorId } });
  });

  await test('T22 — Empreiteiro inexistente em /works → 404', async () => {
    const r = await request('GET', '/api/contractors/00000000-0000-0000-0000-000000000000/works', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTRACTOR_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T23 — Email inválido na criação → 400', async () => {
    const r = await request('POST', '/api/contractors',
      { name: '__TEST_EMAIL_INV__', email: 'nao-e-email' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'VALIDATION_ERROR', `code: ${r.body.error.code}`);
  });

  await test('T24 — Criação auditada (CREATE_CONTRACTOR)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdContractorId, action: 'CREATE_CONTRACTOR' },
    });
    assert(log !== null, 'log CREATE_CONTRACTOR não encontrado');
    assert(log.user_id === adminId, 'actor incorreto na auditoria');
  });

  await test('T25 — Atualização auditada (old/new values)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdContractorId, action: 'UPDATE_CONTRACTOR' },
    });
    assert(log !== null, 'log UPDATE_CONTRACTOR não encontrado');
    assert(log.old_values !== null, 'old_values deve estar presente');
    assert(log.new_values !== null, 'new_values deve estar presente');
  });

  await test('T26 — Inativação auditada (DISABLE_CONTRACTOR)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdContractorId, action: 'DISABLE_CONTRACTOR' },
    });
    assert(log !== null, 'log DISABLE_CONTRACTOR não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

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
