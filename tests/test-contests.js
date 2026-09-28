'use strict';

/**
 * Testes — Contestação
 *
 * T01  Sem token → 401
 * T02  Contractor contesta medição em FISCAL_REVIEW → 201 (OPEN) + FLOW_BLOCKED
 * T03  Contestar em status inválido → 400
 * T04  Contestar sem reason → 400
 * T05  Não pode abrir segunda contestação enquanto OPEN → 409
 * T06  Contractor não autorizado em outra medição → 403
 * T07  Coordinator resolve contestação → 200 (RESOLVED) + retorna a FISCAL_REVIEW
 * T08  Resolver contestação já resolvida → 409
 * T09  Resolver sem resolution → 400
 * T10  Perfil não autorizado não pode resolver → 403
 * T11  Listar contestações da medição → 200
 * T12  Buscar contestação por ID → 200
 * T13  Auditoria CONTEST_MEASUREMENT gerada
 * T14  Auditoria RESOLVE_CONTEST gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, fiscalToken, contractorToken;
let adminId, coordId, fiscalId, contractorUserId;
let adminRoleId, coordRoleId, fiscalRoleId, contractorRoleId;
let testContractorId, testWorkId, testServiceId;
let measFiscalId, contestId;

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

async function setup() {
  const roles = await prisma.roles.findMany({ where: { name: { in: ['ADMIN','COORDINATOR','FISCAL','CONTRACTOR'] } } });
  const rm = Object.fromEntries(roles.map(r => [r.name, r.id]));
  adminRoleId = rm['ADMIN']; coordRoleId = rm['COORDINATOR']; fiscalRoleId = rm['FISCAL']; contractorRoleId = rm['CONTRACTOR'];

  await assignPerm(adminRoleId,      ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.approve','measurements.contest','measurements.resolve_contest']);
  await assignPerm(coordRoleId,      ['measurements.view','measurements.resolve_contest','measurements.approve']);
  await assignPerm(fiscalRoleId,     ['measurements.view','measurements.approve','measurements.return']);
  await assignPerm(contractorRoleId, ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.contest']);

  const hash = await bcrypt.hash('Test@Cont123', 12);
  const [admin, coord, fiscal, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__CO_ADMIN__', email: 'coadmin@co.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CO_COORD__', email: 'cocoord@co.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CO_FISC__',  email: 'cofisc@co.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CO_CONTR__', email: 'cocontr@co.test', password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; fiscalId = fiscal.id; contractorUserId = contr.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,          role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: coordId,          role_id: coordRoleId      } }),
    prisma.user_roles.create({ data: { user_id: fiscalId,         role_id: fiscalRoleId     } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId } }),
  ]);

  const contractor = await prisma.contractors.create({ data: { name: '__CO_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const work = await prisma.works.create({ data: { code: '__COW01__', name: 'Obra CO', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    prisma.user_works.create({ data: { user_id: fiscalId, work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: coordId,  work_id: testWorkId } }),
  ]);

  const svc = await prisma.services.create({ data: { code: '__CO_SVC__', name: 'Serv CO', unit: 'UN', active: true } });
  testServiceId = svc.id;

  // Criar medição em FISCAL_REVIEW diretamente no banco
  const meas = await prisma.measurements.create({
    data: { work_id: testWorkId, contractor_id: testContractorId, status: 'FISCAL_REVIEW', is_exceptional: false, competence_month: '2026-09', created_by: contractorUserId },
  });
  measFiscalId = meas.id;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const [rA, rC, rF, rCo] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'coadmin@co.test', password: 'Test@Cont123' }),
    request('POST', '/api/auth/login', { email: 'cocoord@co.test', password: 'Test@Cont123' }),
    request('POST', '/api/auth/login', { email: 'cofisc@co.test',  password: 'Test@Cont123' }),
    request('POST', '/api/auth/login', { email: 'cocontr@co.test', password: 'Test@Cont123' }),
  ]);
  adminToken = rA.body.data.token; coordToken = rC.body.data.token;
  fiscalToken = rF.body.data.token; contractorToken = rCo.body.data.token;
}

async function teardown() {
  const allMeas = await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const measIds = allMeas.map(m => m.id);
  if (measIds.length) {
    await prisma.contests.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: measIds } } });
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
  const userIds = [adminId, coordId, fiscalId, contractorUserId].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }
  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — CONTESTAÇÃO ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', `/api/measurements/${measFiscalId}/contests`);
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Contractor contesta medição FISCAL_REVIEW → 201 + FLOW_BLOCKED', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests`, {
      reason: 'Quantidade incorreta', description: 'Valor não bate com AL',
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'OPEN', `contest status: ${r.body.data.status}`);
    contestId = r.body.data.id;

    // Medição deve estar FLOW_BLOCKED
    const m = await request('GET', `/api/measurements/${measFiscalId}`, null, adminToken);
    assert(m.body.data.status === 'FLOW_BLOCKED', `medição status: ${m.body.data.status}`);
  });

  await test('T03 — Contestar em status inválido → 400', async () => {
    // Criar medição em DRAFT
    const mDraft = await prisma.measurements.create({
      data: { work_id: testWorkId, contractor_id: testContractorId, status: 'DRAFT', is_exceptional: false, competence_month: '2026-10', created_by: contractorUserId },
    });
    const r = await request('POST', `/api/measurements/${mDraft.id}/contests`, { reason: 'Tentativa' }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
    await prisma.measurements.delete({ where: { id: mDraft.id } });
  });

  await test('T04 — Contestar sem reason → 400', async () => {
    // Criar nova medição em FISCAL_REVIEW para este teste
    const mFisc2 = await prisma.measurements.create({
      data: { work_id: testWorkId, contractor_id: testContractorId, status: 'FISCAL_REVIEW', is_exceptional: false, competence_month: '2026-11', created_by: contractorUserId },
    });
    const r = await request('POST', `/api/measurements/${mFisc2.id}/contests`, {}, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    await prisma.measurements.delete({ where: { id: mFisc2.id } });
  });

  await test('T05 — Não pode abrir segunda contestação enquanto OPEN → 409', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests`, { reason: 'Segunda tentativa' }, contractorToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTEST_ALREADY_OPEN', `code: ${r.body.error.code}`);
  });

  await test('T09 — Resolver sem resolution → 400', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests/${contestId}/resolve`, {}, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'RESOLUTION_REQUIRED', `code: ${r.body.error.code}`);
  });

  await test('T10 — Perfil não autorizado não pode resolver → 403', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests/${contestId}/resolve`, { resolution: 'Aceita' }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T07 — Coordinator resolve → 200 (RESOLVED) + retorna FISCAL_REVIEW', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests/${contestId}/resolve`, { resolution: 'Quantidade corrigida pelo Fiscal' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'RESOLVED', `contest status: ${r.body.data.status}`);

    // Medição deve voltar a FISCAL_REVIEW
    const m = await request('GET', `/api/measurements/${measFiscalId}`, null, adminToken);
    assert(m.body.data.status === 'FISCAL_REVIEW', `medição status: ${m.body.data.status}`);
  });

  await test('T08 — Resolver contestação já resolvida → 409', async () => {
    const r = await request('POST', `/api/measurements/${measFiscalId}/contests/${contestId}/resolve`, { resolution: 'De novo' }, coordToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTEST_ALREADY_RESOLVED', `code: ${r.body.error.code}`);
  });

  await test('T11 — Listar contestações da medição → 200', async () => {
    const r = await request('GET', `/api/measurements/${measFiscalId}/contests`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 1, 'deve ter ao menos 1 contestação');
  });

  await test('T12 — Buscar contestação por ID → 200', async () => {
    const r = await request('GET', `/api/measurements/${measFiscalId}/contests/${contestId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === contestId, 'id correto');
  });

  await test('T13 — Auditoria CONTEST_MEASUREMENT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'CONTEST_MEASUREMENT', entity_type: 'contest' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit CONTEST_MEASUREMENT não encontrado');
  });

  await test('T14 — Auditoria RESOLVE_CONTEST gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'RESOLVE_CONTEST', entity_type: 'contest' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit RESOLVE_CONTEST não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => {
  try { await setup(); await runTests(); }
  catch (err) { console.error('ERRO FATAL:', err.message, err.stack); process.exitCode = 1; }
  finally { await teardown(); }
})();
