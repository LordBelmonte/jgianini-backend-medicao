'use strict';
/**
 * Testes — Financeiro
 * T01 Sem token → 401
 * T02 Cálculo correto após adicionar itens (gross, retention, net)
 * T03 Buscar financeiro da medição → 200
 * T04 Financeiro não existe antes de itens → 404
 * T05 Ajustar adiantamento → 200, net recalculado
 * T06 Ajustar desconto → 200, net recalculado
 * T07 Adiantamento + desconto > disponível → 409
 * T08 Valor negativo → 400
 * T09 Contractor não pode ajustar → 403
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, contractorToken;
let adminId, coordId, contractorUserId;
let testContractorId, testWorkId, testContractId, testServiceId, testMeasId;

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
  const [adminRole, coordRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  await assignPerms(adminRole.id, ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.approve','measurements.cancel','measurements.return']);
  await assignPerms(coordRole.id, ['measurements.view','measurements.update','measurements.approve']);
  await assignPerms(contrRole.id, ['measurements.view','measurements.create','measurements.update','measurements.submit']);

  const hash = await bcrypt.hash('Test@Fin123', 12);
  const [admin, coord, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__FIN_ADMIN__', email: 'fadmin@fin.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__FIN_COORD__', email: 'fcoord@fin.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__FIN_CONTR__', email: 'fcontr@fin.test', password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; contractorUserId = contr.id;
  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId, role_id: adminRole.id } }),
    prisma.user_roles.create({ data: { user_id: coordId, role_id: coordRole.id } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contrRole.id } }),
  ]);
  const contractor = await prisma.contractors.create({ data: { name: '__FIN_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });
  const work = await prisma.works.create({ data: { code: '__FINW01__', name: 'Obra FIN', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    prisma.user_works.create({ data: { user_id: coordId, work_id: testWorkId } }),
  ]);
  const svc = await prisma.services.create({ data: { code: '__FIN_SVC__', name: 'Serv FIN', unit: 'UN', active: true } });
  testServiceId = svc.id;
  const contract = await prisma.contracts.create({ data: { work_id: testWorkId, contractor_id: testContractorId, contract_number: '__FIN_CTR__', retention_percent: 10, status: 'ACTIVE', created_by: adminId } });
  testContractId = contract.id;
  await prisma.contract_services.create({ data: { contract_id: testContractId, service_id: testServiceId, quantity: 100, unit_price: 200, active: true } });

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const [rA, rC, rCo] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'fadmin@fin.test', password: 'Test@Fin123' }),
    request('POST', '/api/auth/login', { email: 'fcoord@fin.test', password: 'Test@Fin123' }),
    request('POST', '/api/auth/login', { email: 'fcontr@fin.test', password: 'Test@Fin123' }),
  ]);
  adminToken = rA.body.data.token; coordToken = rC.body.data.token; contractorToken = rCo.body.data.token;

  // Criar medição com item para ter financeiro
  const rM = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId, competence_month: '2026-09' }, contractorToken);
  testMeasId = rM.body.data.id;
}

async function teardown() {
  const measIds = (await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } })).map(m => m.id);
  if (measIds.length) {
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.reworks.deleteMany({ where: { measurement_id: { in: measIds } } });
    const items = await prisma.measurement_items.findMany({ where: { measurement_id: { in: measIds } }, select: { id: true } });
    await prisma.productions.deleteMany({ where: { measurement_item_id: { in: items.map(i => i.id) } } });
    await prisma.measurement_items.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: measIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: measIds } } });
  }
  await prisma.contract_services.deleteMany({ where: { contract_id: testContractId } });
  await prisma.contracts.deleteMany({ where: { id: testContractId } });
  await prisma.services.deleteMany({ where: { id: testServiceId } });
  await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
  await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
  await prisma.works.deleteMany({ where: { id: testWorkId } });
  await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
  await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  const uids = [adminId, coordId, contractorUserId].filter(Boolean);
  await prisma.user_roles.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.audit_logs.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.users.deleteMany({ where: { id: { in: uids } } });
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — FINANCEIRO ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', `/api/measurements/${testMeasId}/financial`);
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T04 — Financeiro não existe antes de itens → 404', async () => {
    const r = await request('GET', `/api/measurements/${testMeasId}/financial`, null, contractorToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  await test('T02 — Cálculo correto após adicionar item (gross, retention, net)', async () => {
    // Adicionar item: qty=5, price=200 → total=1000; retenção=10% → 100; net=900
    await request('POST', `/api/measurements/${testMeasId}/items`, { service_id: testServiceId, quantity: 5, unit_price: 200 }, contractorToken);
    const r = await request('GET', `/api/measurements/${testMeasId}/financial`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    const fin = r.body.data;
    assert(parseFloat(fin.gross_amount) === 1000, `gross esperado 1000, recebido ${fin.gross_amount}`);
    assert(parseFloat(fin.retention_percent) === 10, `retention_percent esperado 10, recebido ${fin.retention_percent}`);
    assert(parseFloat(fin.retention_amount) === 100, `retention_amount esperado 100, recebido ${fin.retention_amount}`);
    assert(parseFloat(fin.net_amount) === 900, `net esperado 900, recebido ${fin.net_amount}`);
  });

  await test('T03 — Buscar financeiro da medição → 200', async () => {
    const r = await request('GET', `/api/measurements/${testMeasId}/financial`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.measurement_id === testMeasId, 'measurement_id incorreto');
  });

  await test('T05 — Ajustar adiantamento → net recalculado', async () => {
    // gross=1000, ret=100, advance=200 → net = 1000-100-200 = 700
    const r = await request('PATCH', `/api/measurements/${testMeasId}/financial`, { advance_amount: 200 }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(parseFloat(r.body.data.advance_amount) === 200, `advance: ${r.body.data.advance_amount}`);
    assert(parseFloat(r.body.data.net_amount) === 700, `net esperado 700, recebido ${r.body.data.net_amount}`);
  });

  await test('T06 — Ajustar desconto → net recalculado', async () => {
    // advance=200, discount=50 → net = 1000-100-200-50 = 650
    const r = await request('PATCH', `/api/measurements/${testMeasId}/financial`, { advance_amount: 200, discount_amount: 50 }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(parseFloat(r.body.data.net_amount) === 650, `net esperado 650, recebido ${r.body.data.net_amount}`);
  });

  await test('T07 — Adiantamento + desconto > disponível → 409', async () => {
    // gross=1000, ret=100, disponível=900; advance+discount=950 → excede
    const r = await request('PATCH', `/api/measurements/${testMeasId}/financial`, { advance_amount: 800, discount_amount: 200 }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'ADJUSTMENT_EXCEEDS_BALANCE', `code: ${r.body.error.code}`);
  });

  await test('T08 — Valor negativo → 400', async () => {
    const r = await request('PATCH', `/api/measurements/${testMeasId}/financial`, { advance_amount: -50 }, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T09 — Contractor não pode ajustar financeiro → 403', async () => {
    const r = await request('PATCH', `/api/measurements/${testMeasId}/financial`, { advance_amount: 10 }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
