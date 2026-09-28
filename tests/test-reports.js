'use strict';
/**
 * T01 Sem token → 401
 * T02 Admin consulta relatório de medições → 200
 * T03 Admin consulta relatório de ALs → 200
 * T04 Admin consulta relatório de retrabalhos → 200
 * T05 Admin consulta audit-logs → 200
 * T06 Contractor vê somente suas medições no relatório
 * T07 Filtros funcionam (status, competence_month)
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port, adminToken, contractorToken;
let adminId, contractorUserId, testContractorId, testWorkId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...(token ? { 'Authorization': `Bearer ${token}` } : {}) } };
    const req = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); if (bodyStr) req.write(bodyStr); req.end();
  });
}
function assert(c, m) { if (!c) throw new Error(`FALHOU: ${m}`); }

async function assignPerms(roleId, codes) {
  const perms = await prisma.permissions.findMany({ where: { code: { in: codes } } });
  for (const p of perms) await prisma.role_permissions.upsert({ where: { role_id_permission_id: { role_id: roleId, permission_id: p.id } }, update: {}, create: { role_id: roleId, permission_id: p.id } });
}

async function setup() {
  const [adminRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  await assignPerms(adminRole.id, ['reports.view','audit.view','measurements.view','als.view']);
  await assignPerms(contrRole.id, ['reports.view','measurements.view']);

  const hash = await bcrypt.hash('Test@Rep123', 12);
  const [admin, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__REP_ADMIN__', email: 'radmin@rep.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__REP_CONTR__', email: 'rcontr@rep.test', password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; contractorUserId = contr.id;
  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId, role_id: adminRole.id } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contrRole.id } }),
  ]);
  const contractor = await prisma.contractors.create({ data: { name: '__REP_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });
  const work = await prisma.works.create({ data: { code: '__REPW01__', name: 'Obra REP', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } });

  // Criar medição de teste
  await prisma.measurements.create({ data: { work_id: testWorkId, contractor_id: testContractorId, status: 'DRAFT', is_exceptional: false, competence_month: '2026-09', created_by: adminId } });

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const [rA, rC] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'radmin@rep.test', password: 'Test@Rep123' }),
    request('POST', '/api/auth/login', { email: 'rcontr@rep.test', password: 'Test@Rep123' }),
  ]);
  adminToken = rA.body.data.token; contractorToken = rC.body.data.token;
}

async function teardown() {
  const measIds = (await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } })).map(m => m.id);
  if (measIds.length) {
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: measIds } } });
  }
  await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
  await prisma.works.deleteMany({ where: { id: testWorkId } });
  await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
  await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  const uids = [adminId, contractorUserId].filter(Boolean);
  await prisma.user_roles.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.audit_logs.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.users.deleteMany({ where: { id: { in: uids } } });
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — RELATÓRIOS ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/reports/measurements');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Admin consulta relatório de medições → 200', async () => {
    const r = await request('GET', `/api/reports/measurements?work_id=${testWorkId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
    assert(r.body.pagination !== undefined, 'pagination deve existir');
  });

  await test('T03 — Admin consulta relatório de ALs → 200', async () => {
    const r = await request('GET', `/api/reports/als?work_id=${testWorkId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T04 — Admin consulta relatório de retrabalhos → 200', async () => {
    const r = await request('GET', `/api/reports/reworks?work_id=${testWorkId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T05 — Admin consulta audit-logs → 200', async () => {
    const r = await request('GET', '/api/reports/audit-logs', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T06 — Contractor vê somente suas medições no relatório', async () => {
    const r = await request('GET', `/api/reports/measurements?work_id=${testWorkId}`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    for (const m of r.body.items) {
      assert(m.contractor_id === testContractorId, `contractor_id incorreto: ${m.contractor_id}`);
    }
  });

  await test('T07 — Filtro por status funciona', async () => {
    const r = await request('GET', `/api/reports/measurements?work_id=${testWorkId}&status=DRAFT`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    for (const m of r.body.items) {
      assert(m.status === 'DRAFT', `status deve ser DRAFT, recebido ${m.status}`);
    }
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
