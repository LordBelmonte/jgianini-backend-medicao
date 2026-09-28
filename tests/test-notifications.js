'use strict';
/**
 * T01 Sem token → 401
 * T02 Listar notificações do usuário → 200
 * T03 Marcar notificação como lida → 200
 * T04 Marcar todas como lidas → 200
 * T05 Notificação gerada ao submeter medição
 * T06 Notificação gerada ao aprovar (Fiscal)
 * T07 Notificação outro usuário → 403
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port, adminToken, contractorToken;
let adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId;
let testContractorId, testWorkId, testServiceId, testMeasId, notifId;

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
  const allMeas = ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.approve','measurements.return'];
  await Promise.all([
    assignPerms(rm['ADMIN'], allMeas),
    assignPerms(rm['COORDINATOR'], allMeas),
    assignPerms(rm['FISCAL'], ['measurements.view','measurements.approve','measurements.return']),
    assignPerms(rm['RESPONSIBLE'], ['measurements.view','measurements.approve']),
    assignPerms(rm['DIRECTOR'], ['measurements.view','measurements.approve']),
    assignPerms(rm['CONTRACTOR'], ['measurements.view','measurements.create','measurements.update','measurements.submit']),
  ]);

  const hash = await bcrypt.hash('Test@Not123', 12);
  const users = await Promise.all([
    prisma.users.create({ data: { name: '__NOT_ADMIN__', email: 'nadmin@not.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__NOT_COORD__', email: 'ncoord@not.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__NOT_FISC__',  email: 'nfisc@not.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__NOT_RESP__',  email: 'nresp@not.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__NOT_DIR__',   email: 'ndir@not.test',   password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__NOT_CONTR__', email: 'ncontr@not.test', password_hash: hash, active: true } }),
  ]);
  [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId] = users.map(u => u.id);
  const roleNames = ['ADMIN','COORDINATOR','FISCAL','RESPONSIBLE','DIRECTOR','CONTRACTOR'];
  await Promise.all(users.map((u, i) => prisma.user_roles.create({ data: { user_id: u.id, role_id: rm[roleNames[i]] } })));

  const contractor = await prisma.contractors.create({ data: { name: '__NOT_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });
  const work = await prisma.works.create({ data: { code: '__NOTW01__', name: 'Obra NOT', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    ...[fiscalId, coordId, responsibleId, directorId].map(uid => prisma.user_works.create({ data: { user_id: uid, work_id: testWorkId } })),
  ]);
  const svc = await prisma.services.create({ data: { code: '__NOT_SVC__', name: 'Serv NOT', unit: 'UN', active: true } });
  testServiceId = svc.id;

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const [rA, rCo] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'nadmin@not.test', password: 'Test@Not123' }),
    request('POST', '/api/auth/login', { email: 'ncontr@not.test', password: 'Test@Not123' }),
  ]);
  adminToken = rA.body.data.token; contractorToken = rCo.body.data.token;

  // Criar notificação manual para testes T03/T04/T07
  const notif = await prisma.notifications.create({ data: { user_id: contractorUserId, type: 'TEST', title: 'Teste', message: 'Mensagem de teste', entity_type: null, entity_id: null } });
  notifId = notif.id;

  // Criar e submeter medição para T05/T06
  const rM = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-09' }, contractorToken);
  testMeasId = rM.body.data.id;
  await request('POST', `/api/measurements/${testMeasId}/items`, { service_id: testServiceId, quantity: 1, unit_price: 100 }, contractorToken);
}

async function teardown() {
  await prisma.notifications.deleteMany({ where: { user_id: { in: [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId].filter(Boolean) } } });
  const measIds = (await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } })).map(m => m.id);
  if (measIds.length) {
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: measIds } } });
    const items = await prisma.measurement_items.findMany({ where: { measurement_id: { in: measIds } }, select: { id: true } });
    await prisma.productions.deleteMany({ where: { measurement_item_id: { in: items.map(i => i.id) } } });
    await prisma.measurement_items.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: measIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: measIds } } });
  }
  await prisma.services.deleteMany({ where: { id: testServiceId } });
  await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
  await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
  await prisma.works.deleteMany({ where: { id: testWorkId } });
  await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
  await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  const uids = [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId].filter(Boolean);
  await prisma.user_roles.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.audit_logs.deleteMany({ where: { user_id: { in: uids } } });
  await prisma.users.deleteMany({ where: { id: { in: uids } } });
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — NOTIFICAÇÕES ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/notifications');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Listar notificações do usuário → 200', async () => {
    const r = await request('GET', '/api/notifications', null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T03 — Marcar notificação como lida → 200', async () => {
    const r = await request('POST', `/api/notifications/${notifId}/read`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.read_at !== null, 'read_at deve estar preenchido');
  });

  await test('T04 — Marcar todas como lidas → 200', async () => {
    const r = await request('POST', '/api/notifications/read-all', null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
  });

  await test('T07 — Marcar notificação de outro usuário → 403', async () => {
    const r = await request('POST', `/api/notifications/${notifId}/read`, null, adminToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T05 — Notificação gerada ao submeter medição', async () => {
    // Submeter medição gera notificação para Fiscais
    await request('POST', `/api/measurements/${testMeasId}/submit`, null, contractorToken);
    // Aguardar notificação assíncrona
    await new Promise(r => setTimeout(r, 300));
    const notifs = await prisma.notifications.findMany({ where: { user_id: fiscalId, type: 'MEASUREMENT_SUBMITTED' } });
    assert(notifs.length >= 1, `notificação MEASUREMENT_SUBMITTED não gerada para fiscal`);
  });

  await test('T06 — Notificação gerada ao aprovar (Fiscal)', async () => {
    // Aprovar como fiscal
    const fiscalToken = (await request('POST', '/api/auth/login', { email: 'nfisc@not.test', password: 'Test@Not123' })).body.data.token;
    await request('POST', `/api/measurements/${testMeasId}/approvals/approve-fiscal`, {}, fiscalToken);
    await new Promise(r => setTimeout(r, 300));
    // Notificação para responsável
    const notifs = await prisma.notifications.findMany({ where: { user_id: responsibleId, type: 'MEASUREMENT_APPROVED_FISCAL' } });
    assert(notifs.length >= 1, `notificação MEASUREMENT_APPROVED_FISCAL não gerada para responsável`);
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
