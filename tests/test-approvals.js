'use strict';

/**
 * Testes — Aprovações (fluxo normal + excepcional + devolução Diretor)
 *
 * T01  Fiscal aprova → FISCAL_APPROVED → número gerado → RESPONSIBLE_REVIEW
 * T02  Perfil inválido não pode aprovar como Fiscal
 * T03  Responsible aprova → COORDINATOR_REVIEW
 * T04  Coordinator aprova → DIRECTOR_REVIEW
 * T05  Diretor aprova → APPROVED (final)
 * T06  Diretor devolve → COORDINATOR_REVIEW
 * T07  Devolução sem reason → 400
 * T08  Fluxo excepcional: DRAFT_EXCEPTIONAL → submit → COORDINATOR_REVIEW → Coord aprova → DIRECTOR_REVIEW → Diretor aprova
 * T09  Listar aprovações → 200
 * T10  Auditoria APPROVE_FISCAL gerada
 * T11  Auditoria APPROVE_DIRECTOR gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, fiscalToken, responsibleToken, directorToken, contractorToken;
let adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId;
let adminRoleId, coordRoleId, fiscalRoleId, responsibleRoleId, directorRoleId, contractorRoleId;
let testContractorId, testWorkId, testServiceId;
let normalMeasId, exceptionalMeasId;

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

async function assignPerm(roleId, codes) {
  const perms = await prisma.permissions.findMany({ where: { code: { in: codes } } });
  for (const p of perms) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: roleId, permission_id: p.id } },
      update: {}, create: { role_id: roleId, permission_id: p.id },
    });
  }
}

/** Cria uma medição, adiciona um item e submete — retorna o id */
async function createAndSubmit(token, contractorId, workId, svcId, exceptional = false, exceptReason = null) {
  const rC = await request('POST', '/api/measurements', {
    work_id: workId, contractor_id: contractorId, competence_month: '2026-09',
    ...(exceptional ? { is_exceptional: true, exceptional_reason: exceptReason || 'Motivo excepcional' } : {}),
  }, token);
  const id = rC.body.data.id;
  if (!exceptional) {
    await request('POST', `/api/measurements/${id}/items`, { service_id: svcId, quantity: 2, unit_price: 100 }, token);
    await request('POST', `/api/measurements/${id}/submit`, null, token);
  } else {
    await request('POST', `/api/measurements/${id}/items`, { service_id: svcId, quantity: 1, unit_price: 50 }, token);
    await request('POST', `/api/measurements/${id}/submit`, null, token);
  }
  return id;
}

async function setup() {
  const roles = await prisma.roles.findMany({ where: { name: { in: ['ADMIN','COORDINATOR','FISCAL','RESPONSIBLE','DIRECTOR','CONTRACTOR'] } } });
  const roleMap = Object.fromEntries(roles.map(r => [r.name, r.id]));
  adminRoleId      = roleMap['ADMIN'];
  coordRoleId      = roleMap['COORDINATOR'];
  fiscalRoleId     = roleMap['FISCAL'];
  responsibleRoleId = roleMap['RESPONSIBLE'];
  directorRoleId   = roleMap['DIRECTOR'];
  contractorRoleId = roleMap['CONTRACTOR'];

  const allMeasPerms = ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.cancel','measurements.return','measurements.approve'];
  await assignPerm(adminRoleId,       allMeasPerms);
  await assignPerm(coordRoleId,       allMeasPerms);
  await assignPerm(fiscalRoleId,      ['measurements.view','measurements.approve','measurements.return','measurements.update']);
  await assignPerm(responsibleRoleId, ['measurements.view','measurements.approve','measurements.cancel']);
  await assignPerm(directorRoleId,    ['measurements.view','measurements.approve','measurements.return']);
  await assignPerm(contractorRoleId,  ['measurements.view','measurements.create','measurements.update','measurements.submit']);

  const hash = await bcrypt.hash('Test@App123', 12);
  const users = await Promise.all([
    prisma.users.create({ data: { name: '__APP_ADMIN__', email: 'apadmin@app.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__APP_COORD__', email: 'apcoord@app.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__APP_FISC__',  email: 'apfisc@app.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__APP_RESP__',  email: 'apresp@app.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__APP_DIR__',   email: 'apdir@app.test',   password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__APP_CONTR__', email: 'apcontr@app.test', password_hash: hash, active: true } }),
  ]);
  [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId] = users.map(u => u.id);

  const roleAssign = [adminRoleId, coordRoleId, fiscalRoleId, responsibleRoleId, directorRoleId, contractorRoleId];
  await Promise.all(users.map((u, i) => prisma.user_roles.create({ data: { user_id: u.id, role_id: roleAssign[i] } })));

  const contractor = await prisma.contractors.create({ data: { name: '__APP_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const work = await prisma.works.create({ data: { code: '__APPW01__', name: 'Obra APP', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    prisma.user_works.create({ data: { user_id: fiscalId,      work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: coordId,       work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: responsibleId, work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: directorId,    work_id: testWorkId } }),
  ]);

  const svc = await prisma.services.create({ data: { code: '__APP_SVC__', name: 'Serv APP', unit: 'UN', active: true } });
  testServiceId = svc.id;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const tokens = await Promise.all(
    ['apadmin@app.test','apcoord@app.test','apfisc@app.test','apresp@app.test','apdir@app.test','apcontr@app.test']
      .map(email => request('POST', '/api/auth/login', { email, password: 'Test@App123' }))
  );
  [adminToken, coordToken, fiscalToken, responsibleToken, directorToken, contractorToken] = tokens.map(r => r.body.data.token);
}

async function teardown() {
  const allMeas = await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const measIds = allMeas.map(m => m.id);
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
  const userIds = [adminId, coordId, fiscalId, responsibleId, directorId, contractorUserId].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }
  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — APROVAÇÕES ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  // Criar medição em FISCAL_REVIEW para o fluxo normal
  normalMeasId = await createAndSubmit(contractorToken, testContractorId, testWorkId, testServiceId);

  await test('T01 — Fiscal aprova → número gerado → RESPONSIBLE_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${normalMeasId}/approvals/approve-fiscal`, {}, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'RESPONSIBLE_REVIEW', `status: ${r.body.data.status}`);
    assert(r.body.data.number !== null && r.body.data.number !== undefined, 'número deve ter sido gerado');
  });

  await test('T02 — Perfil inválido não pode aprovar como Fiscal → 403', async () => {
    // Criar outra medição em FISCAL_REVIEW
    const id2 = await createAndSubmit(contractorToken, testContractorId, testWorkId, testServiceId);
    const r = await request('POST', `/api/measurements/${id2}/approvals/approve-fiscal`, {}, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T03 — Responsible aprova → COORDINATOR_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${normalMeasId}/approvals/approve-responsible`, {}, responsibleToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'COORDINATOR_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('T04 — Coordinator aprova → DIRECTOR_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${normalMeasId}/approvals/approve-coordinator`, {}, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'DIRECTOR_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('T06 — Diretor devolve → COORDINATOR_REVIEW', async () => {
    // Criar outra medição e levar até DIRECTOR_REVIEW
    const id3 = await createAndSubmit(contractorToken, testContractorId, testWorkId, testServiceId);
    await request('POST', `/api/measurements/${id3}/approvals/approve-fiscal`,      {}, fiscalToken);
    await request('POST', `/api/measurements/${id3}/approvals/approve-responsible`, {}, responsibleToken);
    await request('POST', `/api/measurements/${id3}/approvals/approve-coordinator`, {}, coordToken);

    const r = await request('POST', `/api/measurements/${id3}/approvals/return-director`, { reason: 'Revisar valores' }, directorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'COORDINATOR_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('T07 — Devolução sem reason → 400', async () => {
    const r = await request('POST', `/api/measurements/${normalMeasId}/approvals/return-director`, {}, directorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'REASON_REQUIRED', `code: ${r.body.error.code}`);
  });

  await test('T05 — Diretor aprova → APPROVED (final)', async () => {
    const r = await request('POST', `/api/measurements/${normalMeasId}/approvals/approve-director`, {}, directorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'APPROVED', `status: ${r.body.data.status}`);
  });

  await test('T08 — Fluxo excepcional: COORD cria → submit → COORD aprova → DIR aprova', async () => {
    exceptionalMeasId = await createAndSubmit(coordToken, testContractorId, testWorkId, testServiceId, true, 'Empreiteiro não cadastrado');
    // Coord aprova
    const rCoord = await request('POST', `/api/measurements/${exceptionalMeasId}/approvals/approve-coordinator`, {}, coordToken);
    assert(rCoord.status === 200, `coord aprovar: esperado 200, recebido ${rCoord.status}: ${JSON.stringify(rCoord.body)}`);
    assert(rCoord.body.data.status === 'DIRECTOR_REVIEW', `status após coord: ${rCoord.body.data.status}`);
    assert(rCoord.body.data.number !== null, 'número gerado na aprovação do Coordenador');
    // Dir aprova
    const rDir = await request('POST', `/api/measurements/${exceptionalMeasId}/approvals/approve-director`, {}, directorToken);
    assert(rDir.status === 200, `dir aprovar: esperado 200, recebido ${rDir.status}`);
    assert(rDir.body.data.status === 'APPROVED', `status final: ${rDir.body.data.status}`);
  });

  await test('T09 — Listar aprovações → 200', async () => {
    const r = await request('GET', `/api/measurements/${normalMeasId}/approvals`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 3, `deve ter ao menos 3 aprovações, tem ${r.body.data.length}`);
  });

  await test('T10 — Auditoria APPROVE_FISCAL gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'APPROVE_FISCAL', entity_type: 'measurement' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit APPROVE_FISCAL não encontrado');
  });

  await test('T11 — Auditoria APPROVE_DIRECTOR gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'APPROVE_DIRECTOR', entity_type: 'measurement' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit APPROVE_DIRECTOR não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => {
  try { await setup(); await runTests(); }
  catch (err) { console.error('ERRO FATAL:', err.message, err.stack); process.exitCode = 1; }
  finally { await teardown(); }
})();
