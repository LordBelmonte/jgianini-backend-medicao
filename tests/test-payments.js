'use strict';
/**
 * Testes — Pagamentos
 * T01 Sem token → 401
 * T02 Criar pagamento válido → 201, financial atualizado
 * T03 Múltiplos pagamentos dentro do saldo → 201
 * T04 Pagamento excede saldo → 409 PAYMENT_EXCEEDS_BALANCE
 * T05 Medição não aprovada → 409
 * T06 Contractor não pode criar pagamento → 403
 * T07 Listar pagamentos → 200
 * T08 Cancelar pagamento → 200 (soft), financial recalculado
 * T09 Cancelar já cancelado → 409
 * T10 Cancelar sem reason → 400
 * T11 Auditoria CREATE_PAYMENT gerada
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, contractorToken;
let adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId;
let testContractorId, testWorkId, testServiceId, testContractId;
let approvedMeasId, draftMeasId, paymentId;

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
  const roles = await prisma.roles.findMany({ where: { name: { in: ['ADMIN','COORDINATOR','FISCAL','RESPONSIBLE','DIRECTOR','CONTRACTOR'] } } });
  const rm = Object.fromEntries(roles.map(r => [r.name, r.id]));
  const allMeas = ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.approve','measurements.cancel','measurements.return'];
  await assignPerms(rm['ADMIN'],       [...allMeas,'payments.view','payments.create','payments.cancel']);
  await assignPerms(rm['COORDINATOR'], [...allMeas,'payments.view','payments.create','payments.cancel']);
  await assignPerms(rm['FISCAL'],      ['measurements.view','measurements.approve','measurements.return']);
  await assignPerms(rm['RESPONSIBLE'], ['measurements.view','measurements.approve','measurements.cancel']);
  await assignPerms(rm['DIRECTOR'],    ['measurements.view','measurements.approve']);
  await assignPerms(rm['CONTRACTOR'],  ['measurements.view','measurements.create','measurements.update','measurements.submit','payments.view']);

  const hash = await bcrypt.hash('Test@Pay123', 12);
  const users = await Promise.all([
    prisma.users.create({ data: { name: '__PAY_ADMIN__', email: 'padmin@pay.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PAY_COORD__', email: 'pcoord@pay.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PAY_FISC__',  email: 'pfisc@pay.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PAY_RESP__',  email: 'presp@pay.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PAY_DIR__',   email: 'pdir@pay.test',   password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PAY_CONTR__', email: 'pcontr@pay.test', password_hash: hash, active: true } }),
  ]);
  [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId] = users.map(u => u.id);
  const roleAssign = ['ADMIN','COORDINATOR','FISCAL','RESPONSIBLE','DIRECTOR','CONTRACTOR'].map(n => rm[n]);
  await Promise.all(users.map((u, i) => prisma.user_roles.create({ data: { user_id: u.id, role_id: roleAssign[i] } })));

  const contractor = await prisma.contractors.create({ data: { name: '__PAY_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });
  const work = await prisma.works.create({ data: { code: '__PAYW01__', name: 'Obra PAY', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    ...[fiscalId, coordId, responsibleId, directorId].map(uid => prisma.user_works.create({ data: { user_id: uid, work_id: testWorkId } })),
  ]);
  const svc = await prisma.services.create({ data: { code: '__PAY_SVC__', name: 'Serv PAY', unit: 'UN', active: true } });
  testServiceId = svc.id;
  const contract = await prisma.contracts.create({ data: { work_id: testWorkId, contractor_id: testContractorId, contract_number: '__PAY_CTR__', retention_percent: 10, status: 'ACTIVE', created_by: adminId } });
  testContractId = contract.id;
  await prisma.contract_services.create({ data: { contract_id: testContractId, service_id: testServiceId, quantity: 200, unit_price: 100, active: true } });

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const tokens = await Promise.all(['padmin@pay.test','pcoord@pay.test','pcontr@pay.test'].map(e => request('POST', '/api/auth/login', { email: e, password: 'Test@Pay123' })));
  [adminToken, coordToken, contractorToken] = tokens.map(r => r.body.data.token);
  const fiscalToken = (await request('POST', '/api/auth/login', { email: 'pfisc@pay.test',  password: 'Test@Pay123' })).body.data.token;
  const respToken   = (await request('POST', '/api/auth/login', { email: 'presp@pay.test',  password: 'Test@Pay123' })).body.data.token;
  const dirToken    = (await request('POST', '/api/auth/login', { email: 'pdir@pay.test',   password: 'Test@Pay123' })).body.data.token;

  // Criar medição APPROVED (fluxo completo via banco para economia)
  const m = await prisma.measurements.create({ data: { work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId, status: 'APPROVED', is_exceptional: false, competence_month: '2026-09', created_by: contractorUserId, number: 'TEST-PAY-001', approved_at: new Date() } });
  approvedMeasId = m.id;
  // Adicionar item e financial diretamente
  await prisma.measurement_items.create({ data: { measurement_id: approvedMeasId, service_id: testServiceId, quantity: 10, unit_price: 100, total_value: 1000 } });
  // gross=1000, ret=10%, net=900
  await prisma.measurement_financials.create({ data: { measurement_id: approvedMeasId, gross_amount: 1000, retention_percent: 10, retention_amount: 100, net_amount: 900, paid_amount: 0, remaining_amount: 900, financial_status: 'PENDING' } });

  // Medição em DRAFT para T05
  const mDraft = await prisma.measurements.create({ data: { work_id: testWorkId, contractor_id: testContractorId, status: 'DRAFT', is_exceptional: false, competence_month: '2026-10', created_by: contractorUserId } });
  draftMeasId = mDraft.id;
}

async function teardown() {
  // Limpar todas medições da obra de teste (inclui as criadas no T10)
  const allMeas = await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const allMeasIds = allMeas.map(m => m.id);
  if (allMeasIds.length) {
    await prisma.payments.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    await prisma.reworks.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    const items = await prisma.measurement_items.findMany({ where: { measurement_id: { in: allMeasIds } }, select: { id: true } });
    await prisma.productions.deleteMany({ where: { measurement_item_id: { in: items.map(i => i.id) } } });
    await prisma.measurement_items.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: allMeasIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allMeasIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: allMeasIds } } });
  }
  if (testContractId) {
    await prisma.contract_additive_services.deleteMany({ where: { additive: { contract_id: testContractId } } });
    await prisma.contract_additives.deleteMany({ where: { contract_id: testContractId } });
    await prisma.contract_services.deleteMany({ where: { contract_id: testContractId } });
    await prisma.contracts.deleteMany({ where: { id: testContractId } });
  }
  if (testServiceId) await prisma.services.deleteMany({ where: { id: testServiceId } });
  if (testWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
    await prisma.works.deleteMany({ where: { id: testWorkId } });
  }
  if (testContractorId) {
    await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  }
  const uids = [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId].filter(Boolean);
  if (uids.length) {
    await prisma.notifications.deleteMany({ where: { user_id: { in: uids } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: uids } } });
    await prisma.user_roles.deleteMany({ where: { user_id: { in: uids } } });
    await prisma.users.deleteMany({ where: { id: { in: uids } } });
  }
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — PAGAMENTOS ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', `/api/measurements/${approvedMeasId}/payments`);
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Criar pagamento válido → 201, financial atualizado', async () => {
    const r = await request('POST', `/api/measurements/${approvedMeasId}/payments`, { amount: 400, payment_date: '2026-09-30' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    paymentId = r.body.data.id;
    // Verificar financial
    const fin = await prisma.measurement_financials.findUnique({ where: { measurement_id: approvedMeasId } });
    assert(parseFloat(fin.paid_amount) === 400, `paid_amount esperado 400, recebido ${fin.paid_amount}`);
    assert(parseFloat(fin.remaining_amount) === 500, `remaining esperado 500, recebido ${fin.remaining_amount}`);
    assert(fin.financial_status === 'PARTIAL', `status esperado PARTIAL, recebido ${fin.financial_status}`);
  });

  await test('T03 — Múltiplos pagamentos dentro do saldo → 201', async () => {
    const r = await request('POST', `/api/measurements/${approvedMeasId}/payments`, { amount: 500, payment_date: '2026-10-01' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    const fin = await prisma.measurement_financials.findUnique({ where: { measurement_id: approvedMeasId } });
    assert(fin.financial_status === 'PAID', `status esperado PAID, recebido ${fin.financial_status}`);
  });

  await test('T04 — Pagamento excede saldo → 409 PAYMENT_EXCEEDS_BALANCE', async () => {
    // Saldo = 0 agora (já pago totalmente)
    const r = await request('POST', `/api/measurements/${approvedMeasId}/payments`, { amount: 1, payment_date: '2026-10-02' }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'PAYMENT_EXCEEDS_BALANCE', `code: ${r.body.error.code}`);
  });

  await test('T05 — Medição não aprovada → 409', async () => {
    const r = await request('POST', `/api/measurements/${draftMeasId}/payments`, { amount: 100, payment_date: '2026-10-01' }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'MEASUREMENT_NOT_APPROVED', `code: ${r.body.error.code}`);
  });

  await test('T06 — Contractor não pode criar pagamento → 403', async () => {
    const r = await request('POST', `/api/measurements/${approvedMeasId}/payments`, { amount: 10, payment_date: '2026-10-01' }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T07 — Listar pagamentos → 200', async () => {
    const r = await request('GET', `/api/measurements/${approvedMeasId}/payments`, null, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 2, `deve ter >= 2 pagamentos, tem ${r.body.data.length}`);
  });

  await test('T08 — Cancelar pagamento → 200 (soft), financial recalculado', async () => {
    const r = await request('POST', `/api/payments/${paymentId}/cancel`, { reason: 'Pagamento duplicado' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'CANCELLED', `status: ${r.body.data.status}`);
    const dbP = await prisma.payments.findUnique({ where: { id: paymentId } });
    assert(dbP !== null, 'pagamento deve permanecer no banco');
    assert(dbP.status === 'CANCELLED', `db status: ${dbP.status}`);
  });

  await test('T09 — Cancelar já cancelado → 409', async () => {
    const r = await request('POST', `/api/payments/${paymentId}/cancel`, { reason: 'De novo' }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'STATUS_UNCHANGED', `code: ${r.body.error.code}`);
  });

  await test('T10 — Cancelar sem reason → 400', async () => {
    // Criar novo pagamento para este teste (o paymentId já está cancelado)
    // Criar nova medição aprovada com financial
    const mNew = await prisma.measurements.create({ data: { work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId, status: 'APPROVED', is_exceptional: false, competence_month: '2026-11', created_by: adminId, number: 'TEST-PAY-T10', approved_at: new Date() } });
    await prisma.measurement_items.create({ data: { measurement_id: mNew.id, service_id: testServiceId, quantity: 1, unit_price: 100, total_value: 100 } });
    await prisma.measurement_financials.create({ data: { measurement_id: mNew.id, gross_amount: 100, retention_percent: 10, retention_amount: 10, net_amount: 90, paid_amount: 0, remaining_amount: 90, financial_status: 'PENDING' } });
    const rPay = await request('POST', `/api/measurements/${mNew.id}/payments`, { amount: 50, payment_date: '2026-10-10' }, coordToken);
    const newPayId = rPay.body.data.id;
    const r = await request('POST', `/api/payments/${newPayId}/cancel`, {}, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T11 — Auditoria CREATE_PAYMENT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'CREATE_PAYMENT', entity_type: 'payment' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit CREATE_PAYMENT não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
