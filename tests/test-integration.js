'use strict';
/**
 * TESTE DE INTEGRAÇÃO COMPLETO — Fluxo ponta a ponta
 *
 * Fluxo normal:
 * 1. Criar contrato ativo com serviço
 * 2. Criar AL aprovada
 * 3. Criar medição (DRAFT)
 * 4. Adicionar item com AL
 * 5. Submeter (→ FISCAL_REVIEW)
 * 6. Fiscal aprova (→ número gerado → RESPONSIBLE_REVIEW)
 * 7. Responsável aprova (→ COORDINATOR_REVIEW)
 * 8. Coordenador aprova (→ DIRECTOR_REVIEW)
 * 9. Diretor aprova (→ APPROVED)
 * 10. Verificar financeiro (gross/retention/net)
 * 11. Registrar pagamento parcial
 * 12. Registrar pagamento final (→ PAID)
 * 13. Excesso de pagamento → 409
 * 14. Retrabalho criado em medição DRAFT de outra medição
 * 15. Contestação + resolução
 * 16. Medição excepcional: Coord cria → Coord aprova → Dir aprova
 * 17. Notificações geradas no fluxo
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, fiscalToken, responsibleToken, directorToken, contractorToken;
let adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId;
let testContractorId, testWorkId, testContractId, testServiceId, testAlId, testReasonId;
let mainMeasId, reworkMeasId;

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
  const allMeas = ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.approve','measurements.cancel','measurements.return','measurements.contest','measurements.resolve_contest'];
  await Promise.all([
    assignPerms(rm['ADMIN'],       [...allMeas,'payments.view','payments.create','payments.cancel','als.view','als.import','als.approve','contracts.view','contracts.create','contracts.update']),
    assignPerms(rm['COORDINATOR'], [...allMeas,'payments.view','payments.create','als.view']),
    assignPerms(rm['FISCAL'],      ['measurements.view','measurements.approve','measurements.return']),
    assignPerms(rm['RESPONSIBLE'], ['measurements.view','measurements.approve','measurements.cancel']),
    assignPerms(rm['DIRECTOR'],    ['measurements.view','measurements.approve','measurements.return']),
    assignPerms(rm['CONTRACTOR'],  ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.contest','payments.view','als.view']),
  ]);

  const hash = await bcrypt.hash('Test@Int123', 12);
  const users = await Promise.all([
    prisma.users.create({ data: { name: '__INT_ADMIN__', email: 'iadmin@int.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__INT_COORD__', email: 'icoord@int.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__INT_FISC__',  email: 'ifisc@int.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__INT_RESP__',  email: 'iresp@int.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__INT_DIR__',   email: 'idir@int.test',   password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__INT_CONTR__', email: 'icontr@int.test', password_hash: hash, active: true } }),
  ]);
  [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId] = users.map(u => u.id);
  const roleNames = ['ADMIN','COORDINATOR','FISCAL','RESPONSIBLE','DIRECTOR','CONTRACTOR'];
  await Promise.all(users.map((u, i) => prisma.user_roles.create({ data: { user_id: u.id, role_id: rm[roleNames[i]] } })));

  const contractor = await prisma.contractors.create({ data: { name: '__INT_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const work = await prisma.works.create({ data: { code: '__INTW01__', name: 'Obra INT', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    ...[fiscalId, coordId, responsibleId, directorId].map(uid => prisma.user_works.create({ data: { user_id: uid, work_id: testWorkId } })),
  ]);

  const svc = await prisma.services.create({ data: { code: '__INT_SVC__', name: 'Serv INT', unit: 'UN', active: true } });
  testServiceId = svc.id;

  const contract = await prisma.contracts.create({ data: { work_id: testWorkId, contractor_id: testContractorId, contract_number: '__INT_CTR__', retention_percent: 10, status: 'ACTIVE', created_by: adminId } });
  testContractId = contract.id;
  await prisma.contract_services.create({ data: { contract_id: testContractId, service_id: testServiceId, quantity: 1000, unit_price: 100, active: true } });

  const al = await prisma.als.create({ data: { work_id: testWorkId, service_id: testServiceId, code: 'AL-INT-001', quantity: 500, status: 'APPROVED', imported_by: adminId } });
  testAlId = al.id;

  const reason = await prisma.rework_reasons.findFirst({ where: { active: true } });
  testReasonId = reason.id;

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const emails = ['iadmin@int.test','icoord@int.test','ifisc@int.test','iresp@int.test','idir@int.test','icontr@int.test'];
  const tokens = await Promise.all(emails.map(e => request('POST', '/api/auth/login', { email: e, password: 'Test@Int123' })));
  [adminToken, coordToken, fiscalToken, responsibleToken, directorToken, contractorToken] = tokens.map(r => r.body.data.token);
}

async function teardown() {
  const allMeas = await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const measIds = allMeas.map(m => m.id);
  if (measIds.length) {
    await prisma.contests.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.payments.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.reworks.deleteMany({ where: { measurement_id: { in: measIds } } });
    const items = await prisma.measurement_items.findMany({ where: { measurement_id: { in: measIds } }, select: { id: true } });
    await prisma.productions.deleteMany({ where: { measurement_item_id: { in: items.map(i => i.id) } } });
    await prisma.measurement_items.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: measIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: measIds } } });
  }
  await prisma.als.deleteMany({ where: { id: testAlId } });
  await prisma.contract_services.deleteMany({ where: { contract_id: testContractId } });
  await prisma.contracts.deleteMany({ where: { id: testContractId } });
  await prisma.services.deleteMany({ where: { id: testServiceId } });
  await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
  await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
  await prisma.works.deleteMany({ where: { id: testWorkId } });
  await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
  await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  const uids = [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId].filter(Boolean);
  await prisma.notifications.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.user_roles.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.audit_logs.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.users.deleteMany({ where: { id: { in: uids } } });
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTE DE INTEGRAÇÃO — FLUXO COMPLETO ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  let measItemId, contestId;

  await test('STEP 01 — Contractor cria medição DRAFT', async () => {
    const r = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId, competence_month: '2026-09' }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'DRAFT', `status: ${r.body.data.status}`);
    mainMeasId = r.body.data.id;
  });

  await test('STEP 02 — Adicionar item com AL à medição', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/items`, { service_id: testServiceId, al_id: testAlId, quantity: 10, unit_price: 100 }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    measItemId = r.body.data.id;
  });

  await test('STEP 03 — Submeter medição (DRAFT → FISCAL_REVIEW)', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/submit`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'FISCAL_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('STEP 04 — Contestação abre FLOW_BLOCKED', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/contests`, { reason: 'Quantidade incorreta' }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    contestId = r.body.data.id;
    const m = await request('GET', `/api/measurements/${mainMeasId}`, null, adminToken);
    assert(m.body.data.status === 'FLOW_BLOCKED', `status deve ser FLOW_BLOCKED: ${m.body.data.status}`);
  });

  await test('STEP 05 — Coordinator resolve contestação → FISCAL_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/contests/${contestId}/resolve`, { resolution: 'Quantidade confirmada' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    const m = await request('GET', `/api/measurements/${mainMeasId}`, null, adminToken);
    assert(m.body.data.status === 'FISCAL_REVIEW', `status deve ser FISCAL_REVIEW: ${m.body.data.status}`);
  });

  await test('STEP 06 — Fiscal aprova → número gerado → RESPONSIBLE_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/approvals/approve-fiscal`, {}, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.number !== null, 'número deve ter sido gerado');
    // Verificar formato: NNN-CODE-WORK-CONTR-MM/YYYY
    assert(r.body.data.number.includes('2026'), `número deve conter ano: ${r.body.data.number}`);
    assert(r.body.data.status === 'RESPONSIBLE_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('STEP 07 — Responsible aprova → COORDINATOR_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/approvals/approve-responsible`, {}, responsibleToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'COORDINATOR_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('STEP 08 — Coordinator aprova → DIRECTOR_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/approvals/approve-coordinator`, {}, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'DIRECTOR_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('STEP 09 — Diretor aprova → APPROVED', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/approvals/approve-director`, {}, directorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'APPROVED', `status: ${r.body.data.status}`);
  });

  await test('STEP 10 — Verificar financeiro (gross=1000, ret=100, net=900)', async () => {
    const r = await request('GET', `/api/measurements/${mainMeasId}/financial`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(parseFloat(r.body.data.gross_amount) === 1000, `gross esperado 1000, recebido ${r.body.data.gross_amount}`);
    assert(parseFloat(r.body.data.net_amount) === 900, `net esperado 900, recebido ${r.body.data.net_amount}`);
  });

  await test('STEP 11 — Pagamento parcial (500) → PARTIAL', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/payments`, { amount: 500, payment_date: '2026-09-30' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    const fin = await prisma.measurement_financials.findUnique({ where: { measurement_id: mainMeasId } });
    assert(fin.financial_status === 'PARTIAL', `status financeiro: ${fin.financial_status}`);
  });

  await test('STEP 12 — Pagamento final (400) → PAID', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/payments`, { amount: 400, payment_date: '2026-10-15' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    const fin = await prisma.measurement_financials.findUnique({ where: { measurement_id: mainMeasId } });
    assert(fin.financial_status === 'PAID', `status financeiro: ${fin.financial_status}`);
  });

  await test('STEP 13 — Excesso de pagamento → 409', async () => {
    const r = await request('POST', `/api/measurements/${mainMeasId}/payments`, { amount: 1, payment_date: '2026-10-16' }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'PAYMENT_EXCEEDS_BALANCE', `code: ${r.body.error.code}`);
  });

  await test('STEP 14 — Retrabalho em medição DRAFT', async () => {
    const rNew = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-10' }, contractorToken);
    reworkMeasId = rNew.body.data.id;
    const r = await request('POST', '/api/reworks', { measurement_id: reworkMeasId, reason_id: testReasonId, quantity: 2, unit_price: 150, description: 'Peças incorretas' }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(parseFloat(r.body.data.total_value) === 300, `total_value: ${r.body.data.total_value}`);
  });

  await test('STEP 15 — Medição excepcional: Coord cria → aprova → Dir aprova → APPROVED', async () => {
    const rC = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-11', is_exceptional: true, exceptional_reason: 'Emergência' }, coordToken);
    assert(rC.status === 201, `criar exc: ${rC.status}`);
    const excId = rC.body.data.id;
    await request('POST', `/api/measurements/${excId}/items`, { service_id: testServiceId, quantity: 1, unit_price: 50 }, coordToken);
    await request('POST', `/api/measurements/${excId}/submit`, null, coordToken);
    const rApprC = await request('POST', `/api/measurements/${excId}/approvals/approve-coordinator`, {}, coordToken);
    assert(rApprC.status === 200, `coord aprovar exc: ${rApprC.status}: ${JSON.stringify(rApprC.body)}`);
    assert(rApprC.body.data.number !== null, 'número gerado pelo coordenador');
    const rApprD = await request('POST', `/api/measurements/${excId}/approvals/approve-director`, {}, directorToken);
    assert(rApprD.status === 200, `dir aprovar exc: ${rApprD.status}`);
    assert(rApprD.body.data.status === 'APPROVED', `status final: ${rApprD.body.data.status}`);
  });

  await test('STEP 16 — Auditoria do fluxo registrada', async () => {
    const logs = await prisma.audit_logs.findMany({ where: { entity_id: mainMeasId }, orderBy: { created_at: 'asc' } });
    assert(logs.length >= 5, `deve ter >= 5 logs, tem ${logs.length}`);
    const actions = logs.map(l => l.action);
    assert(actions.includes('CREATE_MEASUREMENT'), 'CREATE_MEASUREMENT deve existir');
    assert(actions.includes('APPROVE_DIRECTOR'), 'APPROVE_DIRECTOR deve existir');
    // Pagamento tem entity_type=payment e entity_id=payment.id — verificar separadamente
    const payLog = await prisma.audit_logs.findFirst({ where: { action: 'CREATE_PAYMENT', entity_type: 'payment' }, orderBy: { created_at: 'desc' } });
    assert(payLog !== null, 'CREATE_PAYMENT deve existir');
  });

  await test('STEP 17 — Notificações geradas no fluxo', async () => {
    await new Promise(r => setTimeout(r, 500));
    const notifs = await prisma.notifications.findMany({ where: { entity_id: mainMeasId } });
    assert(notifs.length >= 1, `deve ter >= 1 notificação para a medição, tem ${notifs.length}`);
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
