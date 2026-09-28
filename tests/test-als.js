'use strict';

/**
 * Testes da Etapa 9 — Módulo de ALs
 *
 * T01  Sem token → 401
 * T02  Admin importa AL válida → 201 (IMPORTED)
 * T03  Importar sem work_id → 400
 * T04  Importar sem code → 400
 * T05  Importar com quantity=0 → 400
 * T06  Admin lista ALs → 200
 * T07  Admin busca AL por ID → 200 (com balance)
 * T08  ID inexistente → 404
 * T09  Admin aprova AL → 200 (APPROVED)
 * T10  Aprovar já aprovada → 400
 * T11  Consultar saldo AL → 200 (sem consumo: balance = quantity)
 * T12  Admin cancela AL → 200 (CANCELLED)
 * T13  Cancelar já cancelada → 409
 * T14  Cancelar sem reason → 400
 * T15  AL cancelada permanece no banco
 * T16  Admin vincula empreiteiro à AL → 201
 * T17  Vincular empreiteiro já vinculado → 409
 * T18  Empreiteiro COM vínculo vê a AL → 200
 * T19  Empreiteiro SEM vínculo não vê AL com restrição → 403
 * T20  AL sem restrição: empreiteiro da obra vê → 200
 * T21  Admin remove vínculo empreiteiro → 200
 * T22  Vínculo inexistente → 404
 * T23  Auditoria IMPORT_AL gerada
 * T24  Auditoria APPROVE_AL gerada
 * T25  Auditoria CANCEL_AL gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, contractorToken, contractorToken2;
let adminId, coordId, contractorUserId, contractorUserId2;
let adminRoleId, coordRoleId, contractorRoleId;
let testContractorId, testContractorId2, testWorkId;
let alId, alRestrictedId, alCancelledId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token   ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, res => {
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

async function setup() {
  const [adminRole, coordRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId      = adminRole.id;
  coordRoleId      = coordRole.id;
  contractorRoleId = contrRole.id;

  const permCodes = ['als.view', 'als.import', 'als.approve', 'als.link'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    for (const roleId of [adminRoleId, coordRoleId]) {
      await prisma.role_permissions.upsert({
        where:  { role_id_permission_id: { role_id: roleId, permission_id: perm.id } },
        update: {}, create: { role_id: roleId, permission_id: perm.id },
      });
    }
  }
  const viewPerm = perms.find(p => p.code === 'als.view');
  await prisma.role_permissions.upsert({
    where:  { role_id_permission_id: { role_id: contractorRoleId, permission_id: viewPerm.id } },
    update: {}, create: { role_id: contractorRoleId, permission_id: viewPerm.id },
  });

  const hash = await bcrypt.hash('Test@Als123', 12);
  const [admin, coord, contr1, contr2] = await Promise.all([
    prisma.users.create({ data: { name: '__AL_ADMIN__',  email: 'aladmin@al.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__AL_COORD__',  email: 'alcoord@al.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__AL_CONTR1__', email: 'alcontr1@al.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__AL_CONTR2__', email: 'alcontr2@al.test', password_hash: hash, active: true } }),
  ]);
  adminId           = admin.id;
  coordId           = coord.id;
  contractorUserId  = contr1.id;
  contractorUserId2 = contr2.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,           role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: coordId,           role_id: coordRoleId      } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId,  role_id: contractorRoleId } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId2, role_id: contractorRoleId } }),
  ]);

  const [c1, c2] = await Promise.all([
    prisma.contractors.create({ data: { name: '__AL_EMP1__', active: true } }),
    prisma.contractors.create({ data: { name: '__AL_EMP2__', active: true } }),
  ]);
  testContractorId  = c1.id;
  testContractorId2 = c2.id;

  await Promise.all([
    prisma.users.update({ where: { id: contractorUserId  }, data: { contractor_id: testContractorId  } }),
    prisma.users.update({ where: { id: contractorUserId2 }, data: { contractor_id: testContractorId2 } }),
  ]);

  const work = await prisma.works.create({ data: { code: '__ALW01__', name: 'Obra AL', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;

  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId,  active: true } }),
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId2, active: true } }),
    prisma.user_works.create({ data: { user_id: coordId, work_id: testWorkId } }),
  ]);

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const [rA, rC, rCo1, rCo2] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'aladmin@al.test',  password: 'Test@Als123' }),
    request('POST', '/api/auth/login', { email: 'alcoord@al.test',  password: 'Test@Als123' }),
    request('POST', '/api/auth/login', { email: 'alcontr1@al.test', password: 'Test@Als123' }),
    request('POST', '/api/auth/login', { email: 'alcontr2@al.test', password: 'Test@Als123' }),
  ]);
  adminToken       = rA.body.data.token;
  coordToken       = rC.body.data.token;
  contractorToken  = rCo1.body.data.token;
  contractorToken2 = rCo2.body.data.token;
}

async function teardown() {
  const alIds = [alId, alRestrictedId, alCancelledId].filter(Boolean);
  // Buscar todas ALs de teste
  const allAls = await prisma.als.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const allAlIds = [...new Set([...alIds, ...allAls.map(a => a.id)])];

  if (allAlIds.length) {
    await prisma.al_contractors.deleteMany({ where: { al_id: { in: allAlIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allAlIds } } });
    await prisma.als.deleteMany({ where: { id: { in: allAlIds } } });
  }

  if (testWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
    await prisma.works.deleteMany({ where: { id: testWorkId } });
  }

  const empIds = [testContractorId, testContractorId2].filter(Boolean);
  if (empIds.length) {
    await prisma.users.updateMany({ where: { contractor_id: { in: empIds } }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: { in: empIds } } });
  }

  const userIds = [adminId, coordId, contractorUserId, contractorUserId2].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }

  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — ETAPA 9: ALs ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/als');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Admin importa AL válida → 201 (IMPORTED)', async () => {
    const r = await request('POST', '/api/als/import', {
      work_id:  testWorkId,
      code:     'AL-TEST-001',
      quantity: 100,
      description: 'AL de teste',
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'IMPORTED', `status: ${r.body.data.status}`);
    alId = r.body.data.id;
  });

  await test('T03 — Importar sem work_id → 400', async () => {
    const r = await request('POST', '/api/als/import', { code: 'AL-X', quantity: 10 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T04 — Importar sem code → 400', async () => {
    const r = await request('POST', '/api/als/import', { work_id: testWorkId, quantity: 10 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T05 — Importar com quantity=0 → 400', async () => {
    const r = await request('POST', '/api/als/import', { work_id: testWorkId, code: 'AL-ZERO', quantity: 0 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T06 — Admin lista ALs → 200', async () => {
    const r = await request('GET', `/api/als?work_id=${testWorkId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T07 — Admin busca AL por ID → 200 (com balance)', async () => {
    const r = await request('GET', `/api/als/${alId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === alId, 'id correto');
    assert(r.body.data.balance !== undefined, 'balance deve existir');
  });

  await test('T08 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/als/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  await test('T09 — Admin aprova AL → 200 (APPROVED)', async () => {
    const r = await request('POST', `/api/als/${alId}/approve`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'APPROVED', `status: ${r.body.data.status}`);
  });

  await test('T10 — Aprovar já aprovada → 400', async () => {
    const r = await request('POST', `/api/als/${alId}/approve`, null, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  await test('T11 — Consultar saldo AL → 200 (sem consumo: balance = quantity)', async () => {
    const r = await request('GET', `/api/als/${alId}/balance`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(parseFloat(r.body.data.available_balance) === 100, `balance esperado 100, recebido ${r.body.data.available_balance}`);
    assert(parseFloat(r.body.data.consumed_quantity) === 0, `consumed esperado 0, recebido ${r.body.data.consumed_quantity}`);
  });

  // ─── CANCELAMENTO ─────────────────────────────────────────────────────────

  await test('T12 — Admin cancela AL → 200 (CANCELLED)', async () => {
    // Criar nova AL para cancelar
    const rNew = await request('POST', '/api/als/import', {
      work_id: testWorkId, code: 'AL-TO-CANCEL', quantity: 50,
    }, adminToken);
    alCancelledId = rNew.body.data.id;

    const r = await request('POST', `/api/als/${alCancelledId}/cancel`, { reason: 'Importada com erro' }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'CANCELLED', `status: ${r.body.data.status}`);
  });

  await test('T13 — Cancelar já cancelada → 409', async () => {
    const r = await request('POST', `/api/als/${alCancelledId}/cancel`, { reason: 'De novo' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'STATUS_UNCHANGED', `code: ${r.body.error.code}`);
  });

  await test('T14 — Cancelar sem reason → 400', async () => {
    const rNew = await request('POST', '/api/als/import', { work_id: testWorkId, code: 'AL-NO-REASON', quantity: 20 }, adminToken);
    const nrid = rNew.body.data.id;
    const r = await request('POST', `/api/als/${nrid}/cancel`, {}, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T15 — AL cancelada permanece no banco', async () => {
    const al = await prisma.als.findUnique({ where: { id: alCancelledId } });
    assert(al !== null, 'AL cancelada deve permanecer no banco');
    assert(al.status === 'CANCELLED', `status: ${al.status}`);
    assert(al.cancellation_reason !== null, 'cancellation_reason deve estar preenchido');
  });

  // ─── RESTRIÇÃO POR EMPREITEIRO ────────────────────────────────────────────

  await test('T16 — Admin vincula empreiteiro à AL → 201', async () => {
    // Criar AL restrita
    const rNew = await request('POST', '/api/als/import', { work_id: testWorkId, code: 'AL-RESTRICTED', quantity: 80 }, adminToken);
    alRestrictedId = rNew.body.data.id;
    await request('POST', `/api/als/${alRestrictedId}/approve`, null, adminToken);

    const r = await request('POST', `/api/als/${alRestrictedId}/contractors`, { contractor_id: testContractorId }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T17 — Vincular empreiteiro já vinculado → 409', async () => {
    const r = await request('POST', `/api/als/${alRestrictedId}/contractors`, { contractor_id: testContractorId }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T18 — Empreiteiro COM vínculo vê a AL → 200', async () => {
    const r = await request('GET', `/api/als/${alRestrictedId}`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T19 — Empreiteiro SEM vínculo não vê AL com restrição → 403', async () => {
    // contractorToken2 (testContractorId2) não está vinculado à AL restrita
    const r = await request('GET', `/api/als/${alRestrictedId}`, null, contractorToken2);
    assert(r.status === 403, `esperado 403, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T20 — AL sem restrição: empreiteiro da obra vê → 200', async () => {
    // alId não tem restrição por empreiteiro
    const r = await request('GET', `/api/als/${alId}`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
  });

  await test('T21 — Admin remove vínculo empreiteiro → 200', async () => {
    const r = await request('DELETE', `/api/als/${alRestrictedId}/contractors/${testContractorId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
  });

  await test('T22 — Vínculo inexistente → 404', async () => {
    const r = await request('DELETE', `/api/als/${alRestrictedId}/contractors/${testContractorId}`, null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'LINK_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  // ─── AUDITORIA ────────────────────────────────────────────────────────────

  await test('T23 — Auditoria IMPORT_AL gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'IMPORT_AL', entity_type: 'al' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log IMPORT_AL não encontrado');
    assert(log.user_id === adminId, `user_id: ${log.user_id}`);
  });

  await test('T24 — Auditoria APPROVE_AL gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'APPROVE_AL', entity_type: 'al' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log APPROVE_AL não encontrado');
  });

  await test('T25 — Auditoria CANCEL_AL gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'CANCEL_AL', entity_type: 'al' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log CANCEL_AL não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('ERRO FATAL:', err.message, err.stack);
    process.exitCode = 1;
  } finally {
    await teardown();
  }
})();
