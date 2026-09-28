'use strict';

/**
 * Testes da Etapa 9 — Módulo de Produção
 *
 * T01  Sem token → 401
 * T02  Registrar produção válida (AL APPROVED + medição em DRAFT) → 201
 * T03  Produção reduz saldo da AL
 * T04  Produção vinculada ao measurement_item correto
 * T05  Produção em medição não-editável → 403
 * T06  Produção com AL não aprovada → 409
 * T07  Exceder saldo da AL → 409 (AL_BALANCE_EXCEEDED)
 * T08  Exceder quantity do item → 409 (PRODUCTION_EXCEEDS_ITEM_QUANTITY)
 * T09  Buscar produção por ID → 200
 * T10  ID inexistente → 404
 * T11  Listar produções por item → 200
 * T12  Listar produções por AL → 200
 * T13  Quantidade inválida (0) → 400
 * T14  AL de outra obra → 400 (AL_WORK_MISMATCH)
 * T15  Auditoria CREATE_PRODUCTION gerada
 * T16  Integração: saldo AL após múltiplas produções
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, contractorToken;
let adminId, contractorUserId;
let adminRoleId, contractorRoleId;
let testContractorId, testWorkId, testWorkId2;
let testServiceId, testAlId, testAlId2, testAlOtherWorkId;
let testMeasurementId, testMeasurementItemId;
let testContractId;
let productionId;

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
  const [adminRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId      = adminRole.id;
  contractorRoleId = contrRole.id;

  // Permissões necessárias
  const permCodes = ['measurements.create', 'measurements.view', 'als.view', 'als.import', 'als.approve'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: perm.id },
    });
    if (['measurements.create', 'measurements.view'].includes(perm.code)) {
      await prisma.role_permissions.upsert({
        where:  { role_id_permission_id: { role_id: contractorRoleId, permission_id: perm.id } },
        update: {}, create: { role_id: contractorRoleId, permission_id: perm.id },
      });
    }
  }

  const hash = await bcrypt.hash('Test@Prod123', 12);
  const [admin, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__PROD_ADMIN__', email: 'padmin@prod.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__PROD_CONTR__', email: 'pcontr@prod.test', password_hash: hash, active: true } }),
  ]);
  adminId          = admin.id;
  contractorUserId = contr.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,          role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId } }),
  ]);

  const contractor = await prisma.contractors.create({ data: { name: '__PROD_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const [work1, work2] = await Promise.all([
    prisma.works.create({ data: { code: '__PRODW01__', name: 'Obra PROD1', client_name: 'CLI', status: 'ACTIVE' } }),
    prisma.works.create({ data: { code: '__PRODW02__', name: 'Obra PROD2', client_name: 'CLI', status: 'ACTIVE' } }),
  ]);
  testWorkId  = work1.id;
  testWorkId2 = work2.id;

  await prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } });

  // Serviço
  const svc = await prisma.services.create({ data: { code: '__PROD_SVC__', name: 'Serv Prod', unit: 'M2', active: true } });
  testServiceId = svc.id;

  // Contrato
  const contract = await prisma.contracts.create({
    data: {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: '__PROD_CTR__', retention_percent: 5,
      status: 'ACTIVE', created_by: adminId,
    },
  });
  testContractId = contract.id;

  await prisma.contract_services.create({
    data: { contract_id: testContractId, service_id: testServiceId, quantity: 200, unit_price: 100, active: true },
  });

  // ALs
  const [al1, al2, alOtherWork] = await Promise.all([
    prisma.als.create({ data: { work_id: testWorkId, code: 'AL-PROD-001', quantity: 100, status: 'APPROVED', imported_by: adminId } }),
    prisma.als.create({ data: { work_id: testWorkId, code: 'AL-PROD-002', quantity: 50,  status: 'IMPORTED', imported_by: adminId } }),
    prisma.als.create({ data: { work_id: testWorkId2, code: 'AL-OTHER-WORK', quantity: 200, status: 'APPROVED', imported_by: adminId } }),
  ]);
  testAlId          = al1.id;
  testAlId2         = al2.id;
  testAlOtherWorkId = alOtherWork.id;

  // Medição em DRAFT + item
  const measurement = await prisma.measurements.create({
    data: {
      work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId,
      status: 'DRAFT', is_exceptional: false, competence_month: '2026-09', created_by: contractorUserId,
    },
  });
  testMeasurementId = measurement.id;

  const item = await prisma.measurement_items.create({
    data: {
      measurement_id: testMeasurementId,
      service_id:     testServiceId,
      al_id:          testAlId,
      quantity:       30,
      unit_price:     100,
      total_value:    3000,
    },
  });
  testMeasurementItemId = item.id;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const [rA, rC] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'padmin@prod.test',  password: 'Test@Prod123' }),
    request('POST', '/api/auth/login', { email: 'pcontr@prod.test',  password: 'Test@Prod123' }),
  ]);
  adminToken      = rA.body.data.token;
  contractorToken = rC.body.data.token;
}

async function teardown() {
  // Produções
  await prisma.productions.deleteMany({ where: { al_id: { in: [testAlId, testAlId2].filter(Boolean) } } });
  // Itens de medição
  if (testMeasurementItemId) await prisma.measurement_items.deleteMany({ where: { id: testMeasurementItemId } });
  // Medições
  if (testMeasurementId) await prisma.measurements.deleteMany({ where: { id: testMeasurementId } });
  // Contratos
  if (testContractId) {
    await prisma.contract_services.deleteMany({ where: { contract_id: testContractId } });
    await prisma.contracts.deleteMany({ where: { id: testContractId } });
  }
  // ALs
  const allAlIds = [testAlId, testAlId2, testAlOtherWorkId].filter(Boolean);
  if (allAlIds.length) {
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allAlIds } } });
    await prisma.als.deleteMany({ where: { id: { in: allAlIds } } });
  }
  // Serviço
  if (testServiceId) await prisma.services.deleteMany({ where: { id: testServiceId } });
  // Obras
  for (const wId of [testWorkId, testWorkId2].filter(Boolean)) {
    await prisma.work_contractors.deleteMany({ where: { work_id: wId } });
    await prisma.works.deleteMany({ where: { id: wId } });
  }
  // Empreiteiro
  if (testContractorId) {
    await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  }
  // Usuários
  const userIds = [adminId, contractorUserId].filter(Boolean);
  if (userIds.length) {
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }

  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — ETAPA 9: PRODUÇÃO ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/productions/00000000-0000-0000-0000-000000000000');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Registrar produção válida (AL APPROVED + medição DRAFT) → 201', async () => {
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId,
      quantity:            10,
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.quantity !== undefined, 'quantity deve existir');
    productionId = r.body.data.id;
  });

  await test('T03 — Produção reduz saldo da AL', async () => {
    // AL tinha 100; produção de 10 → saldo deve ser 90
    const al = await prisma.als.findUnique({ where: { id: testAlId } });
    // Calcular via service
    const { getBalance } = require('../src/modules/als/als.service');
    // Chamar direto
    const prismaAls = require('../src/config/prisma');
    const consumed = await prismaAls.productions.aggregate({
      where: { al_id: testAlId },
      _sum:  { quantity: true },
    });
    const { Prisma } = require('@prisma/client');
    const balance = new Prisma.Decimal(al.quantity).sub(consumed._sum.quantity ?? 0);
    assert(parseFloat(balance) === 90, `saldo esperado 90, recebido ${balance}`);
  });

  await test('T04 — Produção vinculada ao measurement_item correto', async () => {
    const prod = await prisma.productions.findUnique({ where: { id: productionId } });
    assert(prod.measurement_item_id === testMeasurementItemId, `measurement_item_id incorreto`);
    assert(prod.al_id === testAlId, `al_id incorreto`);
  });

  await test('T05 — Produção em medição não-editável → 403', async () => {
    // Criar medição em FISCAL_REVIEW
    const m = await prisma.measurements.create({
      data: {
        work_id: testWorkId, contractor_id: testContractorId, contract_id: testContractId,
        status: 'FISCAL_REVIEW', is_exceptional: false, competence_month: '2026-09', created_by: contractorUserId,
      },
    });
    const item = await prisma.measurement_items.create({
      data: { measurement_id: m.id, service_id: testServiceId, al_id: testAlId, quantity: 10, unit_price: 100, total_value: 1000 },
    });

    const r = await request('POST', '/api/productions', {
      measurement_item_id: item.id, al_id: testAlId, quantity: 5,
    }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'MEASUREMENT_NOT_EDITABLE', `code: ${r.body.error.code}`);

    // Cleanup
    await prisma.measurement_items.delete({ where: { id: item.id } });
    await prisma.measurements.delete({ where: { id: m.id } });
  });

  await test('T06 — Produção com AL não aprovada → 409', async () => {
    // testAlId2 está em IMPORTED (não APPROVED)
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId2,
      quantity:            5,
    }, contractorToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'AL_NOT_APPROVED', `code: ${r.body.error.code}`);
  });

  await test('T07 — Exceder saldo da AL → 409 (AL_BALANCE_EXCEEDED)', async () => {
    // AL tem saldo de 90 (após T02), tentar registrar 95
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId,
      quantity:            95,
    }, contractorToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'AL_BALANCE_EXCEEDED', `code: ${r.body.error.code}`);
  });

  await test('T08 — Exceder quantity do item → 409 (PRODUCTION_EXCEEDS_ITEM_QUANTITY)', async () => {
    // Item tem quantity=30; já produzimos 10; tentar mais 25 (total 35 > 30)
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId,
      quantity:            25,
    }, contractorToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'PRODUCTION_EXCEEDS_ITEM_QUANTITY', `code: ${r.body.error.code}`);
  });

  await test('T09 — Buscar produção por ID → 200', async () => {
    const r = await request('GET', `/api/productions/${productionId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === productionId, 'id correto');
  });

  await test('T10 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/productions/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  await test('T11 — Listar produções por item → 200', async () => {
    const r = await request('GET', `/api/productions/item/${testMeasurementItemId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 1, `deve ter ao menos 1 produção`);
  });

  await test('T12 — Listar produções por AL → 200', async () => {
    const r = await request('GET', `/api/productions/al/${testAlId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
  });

  await test('T13 — Quantidade inválida (0) → 400', async () => {
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId,
      quantity:            0,
    }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T14 — AL de outra obra → 400 (AL_WORK_MISMATCH)', async () => {
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlOtherWorkId,
      quantity:            5,
    }, contractorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'AL_WORK_MISMATCH', `code: ${r.body.error.code}`);
  });

  await test('T15 — Auditoria CREATE_PRODUCTION gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'CREATE_PRODUCTION', entity_type: 'production' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log CREATE_PRODUCTION não encontrado');
    assert(log.user_id === contractorUserId, `user_id: ${log.user_id}`);
  });

  await test('T16 — Integração: saldo AL após múltiplas produções', async () => {
    // Registrar mais 15 (total consumido: 10 + 15 = 25; saldo: 75)
    const r = await request('POST', '/api/productions', {
      measurement_item_id: testMeasurementItemId,
      al_id:               testAlId,
      quantity:            15,
    }, contractorToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);

    const consumed = await prisma.productions.aggregate({
      where: { al_id: testAlId },
      _sum:  { quantity: true },
    });
    assert(parseFloat(consumed._sum.quantity) === 25, `consumido esperado 25, recebido ${consumed._sum.quantity}`);
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
