'use strict';

/**
 * Testes — Módulo de Medições
 *
 * T01  Sem token → 401
 * T02  Contractor cria medição válida → 201 (DRAFT)
 * T03  Criar sem work_id → 400
 * T04  Criar com competence_month inválido → 400
 * T05  Medição excepcional requer motivo → 400
 * T06  Contractor cria medição excepcional sem ser Coordinator → 403
 * T07  Coordinator cria medição excepcional → 201 (DRAFT_EXCEPTIONAL)
 * T08  Adicionar item UN à medição → 201
 * T09  Adicionar item M2 à medição → 201 (area_m2 calculado)
 * T10  Adicionar item sem service_id → 400
 * T11  Adicionar item M2 sem width_mm → 400
 * T12  Financial é calculado ao adicionar item
 * T13  Remover item → 200
 * T14  Enviar medição (DRAFT → FISCAL_REVIEW) → 200
 * T15  Enviar medição sem itens → 400
 * T16  Enviar já submetida → 400
 * T17  Admin lista medições → 200
 * T18  Contractor vê somente suas medições
 * T19  Buscar medição por ID → 200
 * T20  ID inexistente → 404
 * T21  Cancelar medição → 200 (CANCELLED)
 * T22  Cancelar sem reason → 400
 * T23  Contractor não pode cancelar → 403
 * T24  Fiscal devolve medição (FISCAL_REVIEW → RETURNED_TO_CONTRACTOR) → 200
 * T25  Devolução sem reason → 400
 * T26  Empreiteiro reenvía (RETURNED → FISCAL_REVIEW) → 200
 * T27  Auditoria CREATE_MEASUREMENT gerada
 * T28  Auditoria SUBMIT_MEASUREMENT gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, fiscalToken, responsibleToken, contractorToken;
let adminId, coordId, fiscalId, responsibleId, contractorUserId;
let adminRoleId, coordRoleId, fiscalRoleId, responsibleRoleId, contractorRoleId;
let testContractorId, testWorkId, testContractId, testServiceIdUN, testServiceIdM2;
let measurementDraftId, measurementFiscalId, measurementItemId;

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
      where:  { role_id_permission_id: { role_id: roleId, permission_id: p.id } },
      update: {}, create: { role_id: roleId, permission_id: p.id },
    });
  }
}

async function setup() {
  const [adminRole, coordRole, fiscalRole, respRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'FISCAL' } }),
    prisma.roles.findUnique({ where: { name: 'RESPONSIBLE' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId      = adminRole.id;
  coordRoleId      = coordRole.id;
  fiscalRoleId     = fiscalRole.id;
  responsibleRoleId = respRole.id;
  contractorRoleId = contrRole.id;

  const allPerms = ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.cancel','measurements.return','measurements.approve','measurements.contest','measurements.resolve_contest'];
  await assignPerm(adminRoleId,       allPerms);
  await assignPerm(coordRoleId,       allPerms);
  await assignPerm(fiscalRoleId,      ['measurements.view','measurements.approve','measurements.return','measurements.update']);
  await assignPerm(responsibleRoleId, ['measurements.view','measurements.approve','measurements.cancel']);
  await assignPerm(contractorRoleId,  ['measurements.view','measurements.create','measurements.update','measurements.submit','measurements.contest']);

  const hash = await bcrypt.hash('Test@Meas123', 12);
  const [admin, coord, fiscal, resp, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__MEAS_ADMIN__',  email: 'madmin@meas.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__MEAS_COORD__',  email: 'mcoord@meas.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__MEAS_FISCAL__', email: 'mfiscal@meas.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__MEAS_RESP__',   email: 'mresp@meas.test',   password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__MEAS_CONTR__',  email: 'mcontr@meas.test',  password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; fiscalId = fiscal.id; responsibleId = resp.id; contractorUserId = contr.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,          role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: coordId,          role_id: coordRoleId      } }),
    prisma.user_roles.create({ data: { user_id: fiscalId,         role_id: fiscalRoleId     } }),
    prisma.user_roles.create({ data: { user_id: responsibleId,    role_id: responsibleRoleId } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId  } }),
  ]);

  const contractor = await prisma.contractors.create({ data: { name: '__MEAS_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const work = await prisma.works.create({ data: { code: '__MEASW01__', name: 'Obra MEAS', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    prisma.user_works.create({ data: { user_id: fiscalId,      work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: coordId,       work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: responsibleId, work_id: testWorkId } }),
  ]);

  const [sUN, sM2] = await Promise.all([
    prisma.services.create({ data: { code: '__MEAS_SUN__', name: 'Serv UN',  unit: 'UN',  active: true } }),
    prisma.services.create({ data: { code: '__MEAS_SM2__', name: 'Serv M2',  unit: 'M2',  active: true } }),
  ]);
  testServiceIdUN = sUN.id;
  testServiceIdM2 = sM2.id;

  const contract = await prisma.contracts.create({
    data: { work_id: testWorkId, contractor_id: testContractorId, contract_number: '__MEAS_CTR__', retention_percent: 10, status: 'ACTIVE', created_by: adminId },
  });
  testContractId = contract.id;
  await Promise.all([
    prisma.contract_services.create({ data: { contract_id: testContractId, service_id: testServiceIdUN, quantity: 200, unit_price: 100, active: true } }),
    prisma.contract_services.create({ data: { contract_id: testContractId, service_id: testServiceIdM2, quantity: 500, unit_price: 50,  active: true } }),
  ]);

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const [rA, rC, rF, rR, rCo] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'madmin@meas.test',  password: 'Test@Meas123' }),
    request('POST', '/api/auth/login', { email: 'mcoord@meas.test',  password: 'Test@Meas123' }),
    request('POST', '/api/auth/login', { email: 'mfiscal@meas.test', password: 'Test@Meas123' }),
    request('POST', '/api/auth/login', { email: 'mresp@meas.test',   password: 'Test@Meas123' }),
    request('POST', '/api/auth/login', { email: 'mcontr@meas.test',  password: 'Test@Meas123' }),
  ]);
  adminToken       = rA.body.data.token;
  coordToken       = rC.body.data.token;
  fiscalToken      = rF.body.data.token;
  responsibleToken = rR.body.data.token;
  contractorToken  = rCo.body.data.token;
}

async function teardown() {
  // Limpar produções, itens, financeiros, histórico, aprovações, contestações, retrabalhos, medições
  const allMeas = await prisma.measurements.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const measIds = allMeas.map(m => m.id);
  if (measIds.length) {
    await prisma.contests.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.approvals.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.reworks.deleteMany({ where: { measurement_id: { in: measIds } } });
    const items = await prisma.measurement_items.findMany({ where: { measurement_id: { in: measIds } }, select: { id: true } });
    const itemIds = items.map(i => i.id);
    if (itemIds.length) await prisma.productions.deleteMany({ where: { measurement_item_id: { in: itemIds } } });
    await prisma.measurement_items.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_financials.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.measurement_status_history.deleteMany({ where: { measurement_id: { in: measIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: measIds } } });
    await prisma.measurements.deleteMany({ where: { id: { in: measIds } } });
  }
  if (testContractId) {
    await prisma.contract_services.deleteMany({ where: { contract_id: testContractId } });
    await prisma.contract_additives.deleteMany({ where: { contract_id: testContractId } });
    await prisma.contracts.deleteMany({ where: { id: testContractId } });
  }
  const svcIds = [testServiceIdUN, testServiceIdM2].filter(Boolean);
  if (svcIds.length) await prisma.services.deleteMany({ where: { id: { in: svcIds } } });
  if (testWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
    await prisma.works.deleteMany({ where: { id: testWorkId } });
  }
  if (testContractorId) {
    await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  }
  const userIds = [adminId, coordId, fiscalId, responsibleId, contractorUserId].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }
  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — MEDIÇÕES ===\n');
  let passed = 0, failed = 0;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/measurements');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Contractor cria medição válida → 201 (DRAFT)', async () => {
    const r = await request('POST', '/api/measurements', {
      work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId, competence_month: '2026-09',
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'DRAFT', `status: ${r.body.data.status}`);
    measurementDraftId = r.body.data.id;
  });

  await test('T03 — Criar sem work_id → 400', async () => {
    const r = await request('POST', '/api/measurements', { contractor_id: testContractorId, competence_month: '2026-09' }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T04 — Criar com competence_month inválido → 400', async () => {
    const r = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '09-2026' }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T05 — Medição excepcional requer motivo → 400', async () => {
    const r = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-09', is_exceptional: true }, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T06 — Contractor cria medição excepcional → 403', async () => {
    const r = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-09', is_exceptional: true, exceptional_reason: 'Motivo' }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T07 — Coordinator cria medição excepcional → 201 (DRAFT_EXCEPTIONAL)', async () => {
    const r = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-09', is_exceptional: true, exceptional_reason: 'Empreiteiro não cadastrado' }, coordToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'DRAFT_EXCEPTIONAL', `status: ${r.body.data.status}`);
  });

  await test('T08 — Adicionar item UN à medição → 201', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/items`, {
      service_id: testServiceIdUN, quantity: 5, unit_price: 100,
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.area_m2 === null || r.body.data.area_m2 === undefined, 'area_m2 deve ser null para UN');
    measurementItemId = r.body.data.id;
  });

  await test('T09 — Adicionar item M2 → 201 (area_m2 calculado)', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/items`, {
      service_id: testServiceIdM2, quantity: 2, unit_price: 50, width_mm: 1000, height_mm: 2000,
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    // area = 1000*2000/1000000 = 2.000
    assert(parseFloat(r.body.data.area_m2) === 2.0, `area_m2 esperado 2, recebido ${r.body.data.area_m2}`);
    // total = qty(2) * area(2) * up(50) = 200
    assert(parseFloat(r.body.data.total_value) === 200, `total_value esperado 200, recebido ${r.body.data.total_value}`);
  });

  await test('T10 — Adicionar item sem service_id → 400', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/items`, { quantity: 1, unit_price: 10 }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T11 — Adicionar item M2 sem width_mm → 400', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/items`, { service_id: testServiceIdM2, quantity: 1, unit_price: 50, height_mm: 2000 }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T12 — Financial é calculado ao adicionar item', async () => {
    const m = await request('GET', `/api/measurements/${measurementDraftId}`, null, contractorToken);
    assert(m.status === 200, `esperado 200, recebido ${m.status}`);
    assert(m.body.data.measurement_financial !== null, 'financial deve existir');
    assert(parseFloat(m.body.data.measurement_financial.gross_amount) > 0, 'gross_amount deve ser > 0');
  });

  await test('T13 — Remover item → 200', async () => {
    // Adicionar item para remover
    const rAdd = await request('POST', `/api/measurements/${measurementDraftId}/items`, { service_id: testServiceIdUN, quantity: 1, unit_price: 10 }, contractorToken);
    const idToRemove = rAdd.body.data.id;
    const r = await request('DELETE', `/api/measurements/${measurementDraftId}/items/${idToRemove}`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
  });

  await test('T14 — Enviar medição (DRAFT → FISCAL_REVIEW) → 200', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/submit`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'FISCAL_REVIEW', `status: ${r.body.data.status}`);
    measurementFiscalId = measurementDraftId;
  });

  await test('T15 — Enviar medição sem itens → 400', async () => {
    // Criar nova medição sem itens
    const rNew = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-10' }, contractorToken);
    const emptyId = rNew.body.data.id;
    const r = await request('POST', `/api/measurements/${emptyId}/submit`, null, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'NO_ITEMS', `code: ${r.body.error.code}`);
  });

  await test('T16 — Enviar já submetida → 400', async () => {
    const r = await request('POST', `/api/measurements/${measurementFiscalId}/submit`, null, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  await test('T17 — Admin lista medições → 200', async () => {
    const r = await request('GET', '/api/measurements', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
  });

  await test('T18 — Contractor vê somente suas medições', async () => {
    const r = await request('GET', '/api/measurements', null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    for (const m of r.body.items) {
      assert(m.contractor_id === testContractorId, `contractor_id incorreto: ${m.contractor_id}`);
    }
  });

  await test('T19 — Buscar medição por ID → 200', async () => {
    const r = await request('GET', `/api/measurements/${measurementDraftId}`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === measurementDraftId, 'id correto');
  });

  await test('T20 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/measurements/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  await test('T21 — Cancelar medição → 200 (CANCELLED)', async () => {
    const rNew = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-11' }, contractorToken);
    const toCancel = rNew.body.data.id;
    // Adicionar item e submeter
    await request('POST', `/api/measurements/${toCancel}/items`, { service_id: testServiceIdUN, quantity: 1, unit_price: 10 }, contractorToken);
    await request('POST', `/api/measurements/${toCancel}/submit`, null, contractorToken);
    const r = await request('POST', `/api/measurements/${toCancel}/cancel`, { reason: 'Erro de lançamento' }, responsibleToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'CANCELLED', `status: ${r.body.data.status}`);
  });

  await test('T22 — Cancelar sem reason → 400', async () => {
    const r = await request('POST', `/api/measurements/${measurementFiscalId}/cancel`, {}, responsibleToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T23 — Contractor não pode cancelar → 403', async () => {
    const r = await request('POST', `/api/measurements/${measurementFiscalId}/cancel`, { reason: 'Tentativa' }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  await test('T24 — Fiscal devolve (FISCAL_REVIEW → RETURNED_TO_CONTRACTOR) → 200', async () => {
    // Criar nova medição e submeter para testar devolução
    const rNew = await request('POST', '/api/measurements', { work_id: testWorkId, contractor_id: testContractorId, competence_month: '2026-12' }, contractorToken);
    const newId = rNew.body.data.id;
    await request('POST', `/api/measurements/${newId}/items`, { service_id: testServiceIdUN, quantity: 3, unit_price: 50 }, contractorToken);
    await request('POST', `/api/measurements/${newId}/submit`, null, contractorToken);

    const r = await request('POST', `/api/measurements/${newId}/return`, { reason: 'Quantidade incorreta' }, fiscalToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'RETURNED_TO_CONTRACTOR', `status: ${r.body.data.status}`);

    // Guardar para T26
    measurementDraftId = newId;
  });

  await test('T25 — Devolução sem reason → 400', async () => {
    const r = await request('POST', `/api/measurements/${measurementFiscalId}/return`, {}, fiscalToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T26 — Empreiteiro reenvía (RETURNED → FISCAL_REVIEW) → 200', async () => {
    const r = await request('POST', `/api/measurements/${measurementDraftId}/resubmit`, null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'FISCAL_REVIEW', `status: ${r.body.data.status}`);
  });

  await test('T27 — Auditoria CREATE_MEASUREMENT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'CREATE_MEASUREMENT', entity_type: 'measurement' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit CREATE_MEASUREMENT não encontrado');
  });

  await test('T28 — Auditoria SUBMIT_MEASUREMENT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'SUBMIT_MEASUREMENT', entity_type: 'measurement' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit SUBMIT_MEASUREMENT não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => {
  try { await setup(); await runTests(); }
  catch (err) { console.error('ERRO FATAL:', err.message, err.stack); process.exitCode = 1; }
  finally { await teardown(); }
})();
