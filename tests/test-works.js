'use strict';

/**
 * Testes da Etapa 5 — Módulo de Obras
 *
 * Cenários (40 testes planejados na análise):
 *   CRUD de obras: T01–T17
 *   Vínculo obra↔usuário: T18–T25
 *   Vínculo obra↔empreiteiro: T26–T33
 *   Auditoria e autorização: T34–T40
 */

require('dotenv').config();

const http    = require('http');
const bcrypt  = require('bcryptjs');
const prisma  = require('../src/config/prisma');
const app     = require('../src/app');

// ─── helpers ─────────────────────────────────────────────────────────────────

let server, port;
let adminToken, coordToken, fiscalToken;
let adminId, coordId, fiscalId, extraUserId;
let adminRoleId, coordRoleId, fiscalRoleId;
let contractorId;
let createdWorkId;

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
  // Buscar perfis do seed
  const [adminRole, coordRole, fiscalRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'FISCAL' } }),
  ]);
  adminRoleId = adminRole.id;
  coordRoleId = coordRole.id;
  fiscalRoleId = fiscalRole.id;

  // Atribuir permissões de obras aos perfis
  const permCodes = ['works.view', 'works.create', 'works.update'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    // Admin: todas
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: perm.id },
    });
  }
  // Coordinator: view + update
  for (const perm of perms.filter(p => p.code !== 'works.create')) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: coordRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: coordRoleId, permission_id: perm.id },
    });
  }
  // Fiscal: somente view
  const viewPerm = perms.find(p => p.code === 'works.view');
  await prisma.role_permissions.upsert({
    where:  { role_id_permission_id: { role_id: fiscalRoleId, permission_id: viewPerm.id } },
    update: {}, create: { role_id: fiscalRoleId, permission_id: viewPerm.id },
  });

  // Criar usuários de teste
  const hash = await bcrypt.hash('Test@Obras123', 12);
  const [admin, coord, fiscal, extra] = await Promise.all([
    prisma.users.create({ data: { name: '__WORK_ADMIN__',  email: 'wadmin@works.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__WORK_COORD__',  email: 'wcoord@works.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__WORK_FISCAL__', email: 'wfiscal@works.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__WORK_EXTRA__',  email: 'wextra@works.test',  password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; fiscalId = fiscal.id; extraUserId = extra.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,  role_id: adminRoleId  } }),
    prisma.user_roles.create({ data: { user_id: coordId,  role_id: coordRoleId  } }),
    prisma.user_roles.create({ data: { user_id: fiscalId, role_id: fiscalRoleId } }),
  ]);

  // Criar empreiteiro de teste
  const contr = await prisma.contractors.create({
    data: { name: '__WORK_CONTRACTOR__', active: true },
  });
  contractorId = contr.id;

  // Iniciar servidor
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  // Obter tokens
  const [rA, rC, rF] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'wadmin@works.test',  password: 'Test@Obras123' }),
    request('POST', '/api/auth/login', { email: 'wcoord@works.test',  password: 'Test@Obras123' }),
    request('POST', '/api/auth/login', { email: 'wfiscal@works.test', password: 'Test@Obras123' }),
  ]);
  adminToken = rA.body.data.token;
  coordToken = rC.body.data.token;
  fiscalToken = rF.body.data.token;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  const userIds = [adminId, coordId, fiscalId, extraUserId].filter(Boolean);

  // Limpar obra de teste e vínculos relacionados
  if (createdWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: createdWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: createdWorkId } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: createdWorkId } });
    await prisma.works.deleteMany({ where: { id: createdWorkId } });
  }
  // Limpar outras obras de teste criadas nos testes
  await prisma.works.deleteMany({ where: { code: { startsWith: '__TEST__' } } });

  if (contractorId) {
    await prisma.work_contractors.deleteMany({ where: { contractor_id: contractorId } });
    await prisma.contractors.deleteMany({ where: { id: contractorId } });
  }

  if (userIds.length) {
    await prisma.user_works.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }

  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 5: OBRAS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  // ─── CRUD de obras ──────────────────────────────────────────────────────────

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/works');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Admin cria obra válida → 201', async () => {
    const r = await request('POST', '/api/works',
      { code: '__TEST__001', name: 'Obra Teste', clientName: 'Cliente Teste', address: 'Rua A' },
      adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.success === true, 'success deve ser true');
    assert(r.body.data.code === '__TEST__001', `code: ${r.body.data.code}`);
    createdWorkId = r.body.data.id;
  });

  await test('T03 — Admin cria obra com código duplicado → 409', async () => {
    const r = await request('POST', '/api/works',
      { code: '__TEST__001', name: 'Duplicada', clientName: 'X' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CODE_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T04 — Admin cria obra sem nome → 400', async () => {
    const r = await request('POST', '/api/works',
      { code: '__TEST__002', clientName: 'X' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T05 — Admin cria obra sem clientName → 400', async () => {
    const r = await request('POST', '/api/works',
      { code: '__TEST__003', name: 'Obra Sem Cliente' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T06 — Admin lista obras → 200 (vê todas)', async () => {
    const r = await request('GET', '/api/works', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.pagination, 'paginação deve estar presente');
  });

  await test('T07 — Fiscal sem vínculo lista obras → lista vazia', async () => {
    const r = await request('GET', '/api/works', null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    // Fiscal sem vínculo nenhum → workIds = [] → nenhuma obra retornada
    // (pode ter obras de outros testes, mas não este fiscal)
    const hasTestWork = r.body.data.some(w => w.id === createdWorkId);
    assert(!hasTestWork, 'Fiscal não vinculado não deve ver a obra de teste');
  });

  await test('T08 — Fiscal vinculado lista obras → vê a obra', async () => {
    // Vincular fiscal à obra de teste via banco direto (sem passar pela API de vínculo)
    await prisma.user_works.create({ data: { user_id: fiscalId, work_id: createdWorkId } });
    const r = await request('GET', '/api/works', null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    const hasWork = r.body.data.some(w => w.id === createdWorkId);
    assert(hasWork, 'Fiscal vinculado deve ver a obra');
    // Remover vínculo para testes posteriores de autorização
    await prisma.user_works.deleteMany({ where: { user_id: fiscalId, work_id: createdWorkId } });
  });

  await test('T09 — Admin busca obra por ID → 200', async () => {
    assert(createdWorkId, 'createdWorkId não definido');
    const r = await request('GET', `/api/works/${createdWorkId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === createdWorkId, 'id incorreto');
  });

  await test('T10 — Fiscal SEM vínculo busca obra por ID → 403', async () => {
    const r = await request('GET', `/api/works/${createdWorkId}`, null, fiscalToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T11 — Fiscal COM vínculo busca obra por ID → 200', async () => {
    await prisma.user_works.create({ data: { user_id: fiscalId, work_id: createdWorkId } });
    const r = await request('GET', `/api/works/${createdWorkId}`, null, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    await prisma.user_works.deleteMany({ where: { user_id: fiscalId, work_id: createdWorkId } });
  });

  await test('T12 — Busca ID inexistente → 404', async () => {
    const r = await request('GET', '/api/works/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'WORK_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T13 — Admin atualiza obra → 200', async () => {
    const r = await request('PATCH', `/api/works/${createdWorkId}`,
      { name: 'Obra Atualizada' }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.name === 'Obra Atualizada', `name: ${r.body.data.name}`);
  });

  await test('T14 — Admin atualiza código para duplicado → 409', async () => {
    // Criar segunda obra para gerar conflito
    const r2 = await request('POST', '/api/works',
      { code: '__TEST__DUP', name: 'Dup', clientName: 'X' }, adminToken);
    const dupId = r2.body.data.id;
    const r = await request('PATCH', `/api/works/${createdWorkId}`,
      { code: '__TEST__DUP' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    // Cleanup
    await prisma.works.delete({ where: { id: dupId } });
  });

  await test('T15 — Admin inativa obra → status=INACTIVE', async () => {
    const r = await request('PATCH', `/api/works/${createdWorkId}/status`,
      { active: false }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'INACTIVE', `status: ${r.body.data.status}`);
  });

  await test('T16 — Admin ativa obra → status=ACTIVE', async () => {
    const r = await request('PATCH', `/api/works/${createdWorkId}/status`,
      { active: true }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'ACTIVE', `status: ${r.body.data.status}`);
  });

  await test('T17 — Inativar obra já ativa → 409 STATUS_UNCHANGED', async () => {
    const r = await request('PATCH', `/api/works/${createdWorkId}/status`,
      { active: true }, adminToken); // já está ativa
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'STATUS_UNCHANGED', `code: ${r.body.error.code}`);
  });

  // ─── vínculos obra↔usuário ──────────────────────────────────────────────────

  await test('T18 — Admin vincula usuário a obra → 201', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/users`,
      { userId: fiscalId }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.user_id === fiscalId, 'user_id incorreto');
  });

  await test('T19 — Admin vincula usuário já vinculado → 409', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/users`,
      { userId: fiscalId }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T20 — Admin vincula usuário inexistente → 404', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/users`,
      { userId: '00000000-0000-0000-0000-000000000000' }, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'USER_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T21 — Coordinator tenta vincular usuário → 403', async () => {
    // Vincular coord à obra primeiro para ter acesso
    await prisma.user_works.create({ data: { user_id: coordId, work_id: createdWorkId } });
    const r = await request('POST', `/api/works/${createdWorkId}/users`,
      { userId: extraUserId }, coordToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T22 — Admin lista usuários da obra → 200', async () => {
    const r = await request('GET', `/api/works/${createdWorkId}/users`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    const hasFiscal = r.body.data.some(u => u.id === fiscalId);
    assert(hasFiscal, 'fiscal deve estar na lista');
  });

  await test('T23 — Admin remove vínculo usuário↔obra → 200', async () => {
    const r = await request('DELETE', `/api/works/${createdWorkId}/users/${fiscalId}`,
      null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    // Confirmar que foi removido
    const check = await prisma.user_works.findUnique({
      where: { user_id_work_id: { user_id: fiscalId, work_id: createdWorkId } },
    });
    assert(check === null, 'vínculo deveria ter sido removido');
  });

  await test('T24 — Admin remove vínculo inexistente → 404', async () => {
    const r = await request('DELETE', `/api/works/${createdWorkId}/users/${fiscalId}`,
      null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T25 — Usuário continua existindo após remoção do vínculo', async () => {
    const user = await prisma.users.findUnique({ where: { id: fiscalId } });
    assert(user !== null, 'usuário deve continuar existindo');
    assert(user.active === true, 'usuário deve continuar ativo');
  });

  // ─── vínculos obra↔empreiteiro ──────────────────────────────────────────────

  await test('T26 — Admin vincula empreiteiro a obra → 201', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/contractors`,
      { contractorId }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.contractor_id === contractorId, 'contractor_id incorreto');
  });

  await test('T27 — Admin vincula empreiteiro já vinculado ativamente → 409', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/contractors`,
      { contractorId }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T28 — Admin vincula empreiteiro inexistente → 404', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/contractors`,
      { contractorId: '00000000-0000-0000-0000-000000000000' }, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTRACTOR_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T29 — Admin lista empreiteiros da obra → 200', async () => {
    const r = await request('GET', `/api/works/${createdWorkId}/contractors`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.some(c => c.id === contractorId), 'empreiteiro deve estar na lista');
  });

  await test('T30 — Admin remove vínculo empreiteiro↔obra → soft-delete (active=false)', async () => {
    const r = await request('DELETE', `/api/works/${createdWorkId}/contractors/${contractorId}`,
      null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    // Confirmar soft-delete: registro deve existir com active=false
    const link = await prisma.work_contractors.findUnique({
      where: { work_id_contractor_id: { work_id: createdWorkId, contractor_id: contractorId } },
    });
    assert(link !== null, 'registro deve permanecer no banco');
    assert(link.active === false, 'active deve ser false após soft-delete');
  });

  await test('T31 — Admin tenta remover vínculo já inativo → 404', async () => {
    const r = await request('DELETE', `/api/works/${createdWorkId}/contractors/${contractorId}`,
      null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T32 — Empreiteiro continua existindo após remoção do vínculo', async () => {
    const c = await prisma.contractors.findUnique({ where: { id: contractorId } });
    assert(c !== null, 'empreiteiro deve continuar existindo no banco');
  });

  await test('T33 — Admin revincular empreiteiro após remoção → reativa (201)', async () => {
    const r = await request('POST', `/api/works/${createdWorkId}/contractors`,
      { contractorId }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    // Confirmar que o registro foi reativado (não duplicado)
    const count = await prisma.work_contractors.count({
      where: { work_id: createdWorkId, contractor_id: contractorId },
    });
    assert(count === 1, `esperado 1 registro, encontrado ${count} (não deve duplicar)`);
    const link = await prisma.work_contractors.findUnique({
      where: { work_id_contractor_id: { work_id: createdWorkId, contractor_id: contractorId } },
    });
    assert(link.active === true, 'vínculo deve estar ativo após reativação');
  });

  // ─── auditoria e autorização ────────────────────────────────────────────────

  await test('T34 — Criação de obra auditada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'CREATE_WORK' },
    });
    assert(log !== null, 'log CREATE_WORK não encontrado');
    assert(log.user_id === adminId, 'actor incorreto');
  });

  await test('T35 — Atualização auditada com old/new values', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'UPDATE_WORK' },
    });
    assert(log !== null, 'log UPDATE_WORK não encontrado');
    assert(log.old_values !== null, 'old_values deve estar presente');
    assert(log.new_values !== null, 'new_values deve estar presente');
  });

  await test('T36 — Inativação auditada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'DISABLE_WORK' },
    });
    assert(log !== null, 'log DISABLE_WORK não encontrado');
  });

  await test('T37 — Vínculo usuário auditado (LINK_USER_WORK)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'LINK_USER_WORK' },
    });
    assert(log !== null, 'log LINK_USER_WORK não encontrado');
  });

  await test('T38 — Remoção de vínculo usuário auditada (UNLINK_USER_WORK)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'UNLINK_USER_WORK' },
    });
    assert(log !== null, 'log UNLINK_USER_WORK não encontrado');
  });

  await test('T39 — Vínculo empreiteiro auditado (LINK_CONTRACTOR_WORK)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'LINK_CONTRACTOR_WORK' },
    });
    assert(log !== null, 'log LINK_CONTRACTOR_WORK não encontrado');
  });

  await test('T40 — Remoção de vínculo empreiteiro auditada (UNLINK_CONTRACTOR_WORK)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: createdWorkId, action: 'UNLINK_CONTRACTOR_WORK' },
    });
    assert(log !== null, 'log UNLINK_CONTRACTOR_WORK não encontrado');
  });

  // ─── resultado ───────────────────────────────────────────────────────────────

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
