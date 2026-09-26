'use strict';

/**
 * Testes da Etapa 8 — Módulo de Contratos
 * (Atualizado: decisões Q1-Q5 aplicadas)
 *
 * T01  Sem token → 401
 * T02  Admin cria contrato válido (DRAFT) → 201
 * T03  created_by é o usuário autenticado
 * T04  notes pode ser criado junto ao contrato
 * T05  contract_number duplicado na mesma obra → 409
 * T06  Mesmo contract_number em obra diferente → 201
 * T07  Criar sem work_id → 400
 * T08  Criar sem contractor_id → 400
 * T09  Criar sem contract_number → 400
 * T10  retention_percent < 0 → 400
 * T11  retention_percent > 100 → 400
 * T12  retention_percent = 0 → 201
 * T13  retention_percent = 100 → 201
 * T14  Admin lista contratos → 200
 * T15  Admin busca por ID → 200
 * T16  ID inexistente → 404
 * T17  DRAFT não é operacional (isContractOperational)
 * T18  DRAFT → ACTIVE → 200
 * T19  ACTIVE dentro da vigência é operacional
 * T20  ACTIVE fora da vigência não é operacional (data final passada)
 * T21  ACTIVE sem vigência é operacional
 * T22  ACTIVE data inicial futura não é operacional
 * T23  ACTIVE → SUSPENDED → 200
 * T24  SUSPENDED não é operacional
 * T25  SUSPENDED → ACTIVE (reativação) → 200
 * T26  ACTIVE → CLOSED → 200
 * T27  SUSPENDED → CLOSED → 200
 * T28  CLOSED não é operacional
 * T29  CLOSED → qualquer → 400 (terminal)
 * T30  Transição inválida DRAFT → SUSPENDED → 400
 * T31  Transição inválida DRAFT → CLOSED → 400
 * T32  CONTRACTOR não pode executar transição de status → 403
 * T33  Atualizar notes → 200
 * T34  Atualizar retention_percent diretamente → 200
 * T35  Atualizar start_date e end_date → 200
 * T36  Atualizar retention abaixo de 0 → 400
 * T37  Adicionar serviço em DRAFT → 201                         [Q1]
 * T38  Listar serviços do contrato → 200
 * T39  Atualizar serviço em DRAFT → 200                        [Q2]
 * T40  Remover serviço em DRAFT → active=false                 [Q5]
 * T41  Contrato pode existir sem serviços
 * T42  Adicionar serviço em ACTIVE → 201 (permitido)           [Q1=A]
 * T43  Atualizar serviço em ACTIVE → 200 (permitido)           [Q2=A]
 * T44  Remover serviço em ACTIVE → active=false                [Q2/Q5=A]
 * T45  Adicionar serviço em SUSPENDED → 201 (permitido)        [Q3=A]
 * T46  Atualizar serviço em SUSPENDED → 200 (permitido)        [Q3=A]
 * T47  Remover serviço em SUSPENDED → active=false             [Q3/Q5=A]
 * T48  Adicionar serviço em CLOSED → 403 (bloqueado)           [Q4=A]
 * T49  Atualizar serviço em CLOSED → 403 (bloqueado)           [Q4=A]
 * T50  Remover serviço em CLOSED → 403 (bloqueado)             [Q4=A]
 * T51  Remoção resulta em active=false, registro persiste      [Q5=B]
 * T52  contract_services não possui campo requires_al
 * T53  services.requires_al continua existindo
 * T54  Consultar saldo → 200
 * T55  CONTRACTOR acessa somente seus contratos
 * T56  CONTRACTOR não acessa contrato de outro empreiteiro → 404
 * T57  Fiscal acessa contratos da obra onde está vinculado
 * T58  Fiscal não acessa contrato de obra não vinculada → 404
 * T59  Auditoria CREATE_CONTRACT gerada
 * T60  Auditoria ACTIVATE_CONTRACT gerada
 * T61  Auditoria UPDATE_CONTRACT gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');
const { isContractOperational } = require('../src/modules/contracts/contracts.service');

// ─── variáveis de estado ──────────────────────────────────────────────────────

let server, port;
let adminToken, coordToken, fiscalToken, contractorToken, contractorToken2;
let adminId, coordId, fiscalId, contractorUserId, contractorUserId2;
let adminRoleId, coordRoleId, fiscalRoleId, contractorRoleId;
let testContractorId, testContractorId2;
let testWorkId, testWorkId2;
let contractDraftId, contractActiveId, contractSuspId, contractClosedId;
let serviceId1;
// Contrato em DRAFT para testes de services (mantido como DRAFT)
let draftSvcContractId, draftSvcServiceId;
// Contrato em ACTIVE para testes de services em ACTIVE
let activeSvcContractId, activeSvcServiceId;
// Contrato em SUSPENDED para testes de services em SUSPENDED
let suspSvcContractId, suspSvcServiceId;
// Contrato em CLOSED para testes bloqueados
let closedSvcContractId;

// ─── helpers ─────────────────────────────────────────────────────────────────

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
    const req = http.request(opts, (res) => {
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

// ─── helpers de contrato ─────────────────────────────────────────────────────

async function createContract(number, workId, contractorId) {
  const r = await request('POST', '/api/contracts', {
    work_id: workId, contractor_id: contractorId,
    contract_number: number, retention_percent: 5,
  }, adminToken);
  if (r.status !== 201) throw new Error(`Falha ao criar contrato ${number}: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function activateContract(id) {
  const r = await request('PATCH', `/api/contracts/${id}/status`, { status: 'ACTIVE' }, coordToken);
  if (r.status !== 200) throw new Error(`Falha ao ativar contrato ${id}: ${JSON.stringify(r.body)}`);
}

async function suspendContract(id) {
  await activateContract(id);
  const r = await request('PATCH', `/api/contracts/${id}/status`, { status: 'SUSPENDED' }, coordToken);
  if (r.status !== 200) throw new Error(`Falha ao suspender contrato ${id}: ${JSON.stringify(r.body)}`);
}

async function closeContract(id) {
  await activateContract(id);
  const r = await request('PATCH', `/api/contracts/${id}/status`, { status: 'CLOSED' }, coordToken);
  if (r.status !== 200) throw new Error(`Falha ao fechar contrato ${id}: ${JSON.stringify(r.body)}`);
}

// ─── setup ───────────────────────────────────────────────────────────────────

async function setup() {
  // Buscar roles
  const [adminRole, coordRole, fiscalRole, contractorRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'FISCAL' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId      = adminRole.id;
  coordRoleId      = coordRole.id;
  fiscalRoleId     = fiscalRole.id;
  contractorRoleId = contractorRole.id;

  // Atribuir permissões de contratos
  const permCodes = ['contracts.view', 'contracts.create', 'contracts.update'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: perm.id },
    });
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: coordRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: coordRoleId, permission_id: perm.id },
    });
  }
  const viewPerm = perms.find(p => p.code === 'contracts.view');
  for (const roleId of [fiscalRoleId, contractorRoleId]) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: roleId, permission_id: viewPerm.id } },
      update: {}, create: { role_id: roleId, permission_id: viewPerm.id },
    });
  }

  // Criar usuários de teste
  const hash = await bcrypt.hash('Test@Contr123', 12);
  const [admin, coord, fiscal, contrUser, contrUser2] = await Promise.all([
    prisma.users.create({ data: { name: '__CTR_ADMIN__',  email: 'cadmin@ctr.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CTR_COORD__',  email: 'ccoord@ctr.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CTR_FISCAL__', email: 'cfiscal@ctr.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CTR_CONTR1__', email: 'ccontr1@ctr.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__CTR_CONTR2__', email: 'ccontr2@ctr.test', password_hash: hash, active: true } }),
  ]);
  adminId           = admin.id;
  coordId           = coord.id;
  fiscalId          = fiscal.id;
  contractorUserId  = contrUser.id;
  contractorUserId2 = contrUser2.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,           role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: coordId,           role_id: coordRoleId      } }),
    prisma.user_roles.create({ data: { user_id: fiscalId,          role_id: fiscalRoleId     } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId,  role_id: contractorRoleId } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId2, role_id: contractorRoleId } }),
  ]);

  // Criar empreiteiros
  const [contr1, contr2] = await Promise.all([
    prisma.contractors.create({ data: { name: '__CTR_EMP1__', active: true } }),
    prisma.contractors.create({ data: { name: '__CTR_EMP2__', active: true } }),
  ]);
  testContractorId  = contr1.id;
  testContractorId2 = contr2.id;

  await Promise.all([
    prisma.users.update({ where: { id: contractorUserId  }, data: { contractor_id: testContractorId  } }),
    prisma.users.update({ where: { id: contractorUserId2 }, data: { contractor_id: testContractorId2 } }),
  ]);

  // Criar obras
  const [work1, work2] = await Promise.all([
    prisma.works.create({ data: { code: '__CTRW01__', name: 'Obra CTR1', client_name: 'CLI', status: 'ACTIVE' } }),
    prisma.works.create({ data: { code: '__CTRW02__', name: 'Obra CTR2', client_name: 'CLI', status: 'ACTIVE' } }),
  ]);
  testWorkId  = work1.id;
  testWorkId2 = work2.id;

  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId,  contractor_id: testContractorId,  active: true } }),
    prisma.work_contractors.create({ data: { work_id: testWorkId2, contractor_id: testContractorId2, active: true } }),
    prisma.user_works.create({ data: { user_id: fiscalId, work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: coordId,  work_id: testWorkId } }),
  ]);

  // Criar serviço de teste
  const svc = await prisma.services.create({
    data: { code: '__CTR_SVC1__', name: 'Serviço CTR Teste', unit: 'M2', requires_al: false, active: true },
  });
  serviceId1 = svc.id;

  // Iniciar servidor
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  // Obter tokens
  const [rA, rC, rF, rCo1, rCo2] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'cadmin@ctr.test',  password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'ccoord@ctr.test',  password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'cfiscal@ctr.test', password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'ccontr1@ctr.test', password: 'Test@Contr123' }),
    request('POST', '/api/auth/login', { email: 'ccontr2@ctr.test', password: 'Test@Contr123' }),
  ]);
  adminToken       = rA.body.data.token;
  coordToken       = rC.body.data.token;
  fiscalToken      = rF.body.data.token;
  contractorToken  = rCo1.body.data.token;
  contractorToken2 = rCo2.body.data.token;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  const testContracts = await prisma.contracts.findMany({
    where: { work_id: { in: [testWorkId, testWorkId2].filter(Boolean) } },
    select: { id: true },
  });
  const allContractIds = testContracts.map(c => c.id);

  if (allContractIds.length) {
    await prisma.contract_additives.deleteMany({ where: { contract_id: { in: allContractIds } } });
    await prisma.contract_services.deleteMany({ where: { contract_id: { in: allContractIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allContractIds } } });
    await prisma.contracts.deleteMany({ where: { id: { in: allContractIds } } });
  }

  if (serviceId1) {
    await prisma.services.deleteMany({ where: { id: serviceId1 } });
  }

  for (const wId of [testWorkId, testWorkId2].filter(Boolean)) {
    await prisma.work_contractors.deleteMany({ where: { work_id: wId } });
    await prisma.user_works.deleteMany({ where: { work_id: wId } });
    await prisma.works.deleteMany({ where: { id: wId } });
  }

  const empIds = [testContractorId, testContractorId2].filter(Boolean);
  if (empIds.length) {
    await prisma.users.updateMany({ where: { contractor_id: { in: empIds } }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: { in: empIds } } });
  }

  const userIds = [adminId, coordId, fiscalId, contractorUserId, contractorUserId2].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }

  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 8: CONTRATOS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  // ─── AUTORIZAÇÃO BASE ─────────────────────────────────────────────────────

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/contracts');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  await test('T02 — Admin cria contrato válido (DRAFT) → 201', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-001', retention_percent: 5,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, 'success deve ser true');
    assert(r.body.data.status === 'DRAFT', `status deve ser DRAFT, recebido ${r.body.data.status}`);
    contractDraftId = r.body.data.id;
  });

  await test('T03 — created_by é o usuário autenticado', async () => {
    const r = await request('GET', `/api/contracts/${contractDraftId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.created_by === adminId, `created_by=${r.body.data.created_by}, esperado=${adminId}`);
  });

  await test('T04 — notes pode ser criado junto ao contrato', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-NOTES', retention_percent: 10,
      notes: 'Observação de teste',
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.notes === 'Observação de teste', `notes: ${r.body.data.notes}`);
    contractActiveId = r.body.data.id;
  });

  await test('T05 — contract_number duplicado na mesma obra → 409', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-001', retention_percent: 5,
    }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CONTRACT_NUMBER_DUPLICATE', `code: ${r.body.error.code}`);
  });

  await test('T06 — Mesmo contract_number em obra diferente → 201', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId2, contractor_id: testContractorId2,
      contract_number: 'CTR-001', retention_percent: 5,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T07 — Criar sem work_id → 400', async () => {
    const r = await request('POST', '/api/contracts', {
      contractor_id: testContractorId, contract_number: 'CTR-X', retention_percent: 5,
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T08 — Criar sem contractor_id → 400', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contract_number: 'CTR-X', retention_percent: 5,
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T09 — Criar sem contract_number → 400', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId, retention_percent: 5,
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T10 — retention_percent < 0 → 400', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-NEG', retention_percent: -1,
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T11 — retention_percent > 100 → 400', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-OVER', retention_percent: 101,
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T12 — retention_percent = 0 → 201', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-RET0', retention_percent: 0,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(parseFloat(r.body.data.retention_percent) === 0, `retention: ${r.body.data.retention_percent}`);
  });

  await test('T13 — retention_percent = 100 → 201', async () => {
    const r = await request('POST', '/api/contracts', {
      work_id: testWorkId, contractor_id: testContractorId,
      contract_number: 'CTR-RET100', retention_percent: 100,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(parseFloat(r.body.data.retention_percent) === 100, `retention: ${r.body.data.retention_percent}`);
  });

  await test('T14 — Admin lista contratos → 200', async () => {
    const r = await request('GET', '/api/contracts', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.success === true, 'success deve ser true');
    assert(Array.isArray(r.body.items), 'items deve ser array');
    assert(typeof r.body.pagination === 'object', 'pagination deve existir');
  });

  await test('T15 — Admin busca por ID → 200', async () => {
    const r = await request('GET', `/api/contracts/${contractDraftId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === contractDraftId, `id: ${r.body.data.id}`);
  });

  await test('T16 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/contracts/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  // ─── isContractOperational ────────────────────────────────────────────────

  await test('T17 — DRAFT não é operacional (isContractOperational)', async () => {
    assert(!isContractOperational({ status: 'DRAFT', start_date: null, end_date: null }), 'DRAFT deve retornar false');
  });

  // ─── STATUS: DRAFT → ACTIVE ───────────────────────────────────────────────

  await test('T18 — DRAFT → ACTIVE → 200', async () => {
    const r = await request('PATCH', `/api/contracts/${contractDraftId}/status`, { status: 'ACTIVE' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'ACTIVE', `status: ${r.body.data.status}`);
  });

  // ─── VIGÊNCIA ─────────────────────────────────────────────────────────────

  await test('T19 — ACTIVE dentro da vigência é operacional', async () => {
    const past   = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    assert(isContractOperational({ status: 'ACTIVE', start_date: past, end_date: future }), 'deve ser operacional');
  });

  await test('T20 — ACTIVE fora da vigência (data final passada) não é operacional', async () => {
    const past = new Date(Date.now() - 86400000 * 2);
    assert(!isContractOperational({ status: 'ACTIVE', start_date: null, end_date: past }), 'deve ser não-operacional');
  });

  await test('T21 — ACTIVE sem vigência é operacional', async () => {
    assert(isContractOperational({ status: 'ACTIVE', start_date: null, end_date: null }), 'deve ser operacional');
  });

  await test('T22 — ACTIVE com data inicial futura não é operacional', async () => {
    const future = new Date(Date.now() + 86400000);
    assert(!isContractOperational({ status: 'ACTIVE', start_date: future, end_date: null }), 'deve ser não-operacional');
  });

  // ─── ACTIVE → SUSPENDED ───────────────────────────────────────────────────

  await test('T23 — ACTIVE → SUSPENDED → 200', async () => {
    const rAct = await request('PATCH', `/api/contracts/${contractActiveId}/status`, { status: 'ACTIVE' }, coordToken);
    assert(rAct.status === 200, `ativar: esperado 200, recebido ${rAct.status}`);
    const r = await request('PATCH', `/api/contracts/${contractActiveId}/status`, { status: 'SUSPENDED' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'SUSPENDED', `status: ${r.body.data.status}`);
    contractSuspId = contractActiveId;
  });

  await test('T24 — SUSPENDED não é operacional', async () => {
    assert(!isContractOperational({ status: 'SUSPENDED', start_date: null, end_date: null }), 'deve retornar false');
  });

  await test('T25 — SUSPENDED → ACTIVE (reativação) → 200', async () => {
    const r = await request('PATCH', `/api/contracts/${contractSuspId}/status`, { status: 'ACTIVE' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'ACTIVE', `status: ${r.body.data.status}`);
  });

  // ─── ACTIVE → CLOSED ─────────────────────────────────────────────────────

  await test('T26 — ACTIVE → CLOSED → 200', async () => {
    const toCloseId = await createContract('CTR-TO-CLOSE', testWorkId, testContractorId);
    await activateContract(toCloseId);
    const r = await request('PATCH', `/api/contracts/${toCloseId}/status`, { status: 'CLOSED' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'CLOSED', `status: ${r.body.data.status}`);
    contractClosedId = toCloseId;
  });

  // ─── SUSPENDED → CLOSED ───────────────────────────────────────────────────

  await test('T27 — SUSPENDED → CLOSED → 200', async () => {
    const toSuspCloseId = await createContract('CTR-SUSP-CLOSE', testWorkId, testContractorId);
    await suspendContract(toSuspCloseId);
    const r = await request('PATCH', `/api/contracts/${toSuspCloseId}/status`, { status: 'CLOSED' }, coordToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.status === 'CLOSED', `status: ${r.body.data.status}`);
  });

  // ─── CLOSED — terminal ────────────────────────────────────────────────────

  await test('T28 — CLOSED não é operacional', async () => {
    assert(!isContractOperational({ status: 'CLOSED', start_date: null, end_date: null }), 'deve retornar false');
  });

  await test('T29 — CLOSED → qualquer → 400 (terminal)', async () => {
    const r = await request('PATCH', `/api/contracts/${contractClosedId}/status`, { status: 'ACTIVE' }, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  // ─── TRANSIÇÕES INVÁLIDAS ─────────────────────────────────────────────────

  await test('T30 — Transição inválida DRAFT → SUSPENDED → 400', async () => {
    const newId = await createContract('CTR-DRAFT-SUSP', testWorkId, testContractorId);
    const r = await request('PATCH', `/api/contracts/${newId}/status`, { status: 'SUSPENDED' }, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  await test('T31 — Transição inválida DRAFT → CLOSED → 400', async () => {
    const newId = await createContract('CTR-DRAFT-CLOSED', testWorkId, testContractorId);
    const r = await request('PATCH', `/api/contracts/${newId}/status`, { status: 'CLOSED' }, coordToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  await test('T32 — CONTRACTOR não pode executar transição de status → 403', async () => {
    // contractDraftId está em ACTIVE (T18)
    const r = await request('PATCH', `/api/contracts/${contractDraftId}/status`, { status: 'SUSPENDED' }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  // ─── ATUALIZAÇÃO ADMINISTRATIVA ──────────────────────────────────────────

  await test('T33 — Atualizar notes → 200', async () => {
    const r = await request('PATCH', `/api/contracts/${contractDraftId}`, {
      notes: 'Nota atualizada pelo teste',
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.notes === 'Nota atualizada pelo teste', `notes: ${r.body.data.notes}`);
  });

  await test('T34 — Atualizar retention_percent diretamente → 200', async () => {
    const r = await request('PATCH', `/api/contracts/${contractDraftId}`, {
      retention_percent: 7.5,
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(parseFloat(r.body.data.retention_percent) === 7.5, `retention: ${r.body.data.retention_percent}`);
  });

  await test('T35 — Atualizar start_date e end_date → 200', async () => {
    const r = await request('PATCH', `/api/contracts/${contractDraftId}`, {
      start_date: new Date(Date.now() - 86400000 * 30).toISOString(),
      end_date:   new Date(Date.now() + 86400000 * 365).toISOString(),
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.start_date !== null, 'start_date deve estar definido');
  });

  await test('T36 — Atualizar retention abaixo de 0 → 400', async () => {
    const r = await request('PATCH', `/api/contracts/${contractDraftId}`, { retention_percent: -5 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  // ─── SERVICES: contrato sem serviços ─────────────────────────────────────

  await test('T41 — Contrato pode existir sem serviços', async () => {
    const emptyId = await createContract('CTR-NO-SVC', testWorkId, testContractorId);
    const r = await request('GET', `/api/contracts/${emptyId}/services`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length === 0, `esperado 0 serviços, tem ${r.body.data.length}`);
  });

  // ─── SERVICES: DRAFT ──────────────────────────────────────────────────────

  await test('T37 — Adicionar serviço em DRAFT → 201 [Q1]', async () => {
    draftSvcContractId = await createContract('CTR-SVC-DRAFT', testWorkId, testContractorId);
    const r = await request('POST', `/api/contracts/${draftSvcContractId}/services`, {
      service_id: serviceId1, quantity: 100, unit_price: 25.5,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.contract_id === draftSvcContractId, 'contract_id incorreto');
    assert(r.body.data.requires_al === undefined, 'requires_al não deve existir em contract_services');
    draftSvcServiceId = r.body.data.id;
  });

  await test('T38 — Listar serviços do contrato → 200', async () => {
    const r = await request('GET', `/api/contracts/${draftSvcContractId}/services`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 1, `deve ter ao menos 1 serviço`);
  });

  await test('T39 — Atualizar serviço em DRAFT → 200 [Q2]', async () => {
    const r = await request('PATCH', `/api/contracts/${draftSvcContractId}/services/${draftSvcServiceId}`, {
      quantity: 150,
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T40 — Remover serviço em DRAFT → active=false [Q5]', async () => {
    // Adicionar segundo serviço para remover
    const rAdd = await request('POST', `/api/contracts/${draftSvcContractId}/services`, {
      service_id: serviceId1, quantity: 10, unit_price: 5,
    }, adminToken);
    assert(rAdd.status === 201, `adicionar para remover: esperado 201, recebido ${rAdd.status}`);
    const toRemoveId = rAdd.body.data.id;

    const rDel = await request('DELETE', `/api/contracts/${draftSvcContractId}/services/${toRemoveId}`, null, adminToken);
    assert(rDel.status === 200, `esperado 200, recebido ${rDel.status}`);

    // Confirmar que o registro permanece no banco com active=false (Q5=B)
    const dbRecord = await prisma.contract_services.findUnique({ where: { id: toRemoveId } });
    assert(dbRecord !== null, 'registro deve permanecer no banco (não DELETE físico)');
    assert(dbRecord.active === false, `active deve ser false, recebido ${dbRecord.active}`);
  });

  // ─── SERVICES: ACTIVE (Q1=A, Q2=A) ───────────────────────────────────────

  await test('T42 — Adicionar serviço em ACTIVE → 201 (permitido) [Q1=A]', async () => {
    activeSvcContractId = await createContract('CTR-SVC-ACTIVE', testWorkId, testContractorId);
    await activateContract(activeSvcContractId);

    const r = await request('POST', `/api/contracts/${activeSvcContractId}/services`, {
      service_id: serviceId1, quantity: 50, unit_price: 10,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    activeSvcServiceId = r.body.data.id;
  });

  await test('T43 — Atualizar serviço em ACTIVE → 200 (permitido) [Q2=A]', async () => {
    const r = await request('PATCH', `/api/contracts/${activeSvcContractId}/services/${activeSvcServiceId}`, {
      quantity: 75,
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T44 — Remover serviço em ACTIVE → active=false [Q2/Q5=A]', async () => {
    // Adicionar serviço novo para remover (não o activeSvcServiceId, que será usado no T54)
    const rAdd = await request('POST', `/api/contracts/${activeSvcContractId}/services`, {
      service_id: serviceId1, quantity: 20, unit_price: 8,
    }, adminToken);
    assert(rAdd.status === 201, `adicionar para remover em ACTIVE: esperado 201, recebido ${rAdd.status}`);
    const toRemoveId = rAdd.body.data.id;

    const rDel = await request('DELETE', `/api/contracts/${activeSvcContractId}/services/${toRemoveId}`, null, adminToken);
    assert(rDel.status === 200, `esperado 200, recebido ${rDel.status}: ${JSON.stringify(rDel.body)}`);

    // Confirmar active=false e que registro persiste (Q5=B)
    const dbRecord = await prisma.contract_services.findUnique({ where: { id: toRemoveId } });
    assert(dbRecord !== null, 'registro deve permanecer no banco');
    assert(dbRecord.active === false, `active deve ser false, recebido ${dbRecord.active}`);
  });

  // ─── SERVICES: SUSPENDED (Q3=A) ───────────────────────────────────────────

  await test('T45 — Adicionar serviço em SUSPENDED → 201 (permitido) [Q3=A]', async () => {
    suspSvcContractId = await createContract('CTR-SVC-SUSP', testWorkId, testContractorId);
    await suspendContract(suspSvcContractId);

    const r = await request('POST', `/api/contracts/${suspSvcContractId}/services`, {
      service_id: serviceId1, quantity: 30, unit_price: 15,
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    suspSvcServiceId = r.body.data.id;
  });

  await test('T46 — Atualizar serviço em SUSPENDED → 200 (permitido) [Q3=A]', async () => {
    const r = await request('PATCH', `/api/contracts/${suspSvcContractId}/services/${suspSvcServiceId}`, {
      quantity: 40,
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('T47 — Remover serviço em SUSPENDED → active=false [Q3/Q5=A]', async () => {
    const rAdd = await request('POST', `/api/contracts/${suspSvcContractId}/services`, {
      service_id: serviceId1, quantity: 5, unit_price: 3,
    }, adminToken);
    assert(rAdd.status === 201, `adicionar para remover em SUSPENDED: esperado 201, recebido ${rAdd.status}`);
    const toRemoveId = rAdd.body.data.id;

    const rDel = await request('DELETE', `/api/contracts/${suspSvcContractId}/services/${toRemoveId}`, null, adminToken);
    assert(rDel.status === 200, `esperado 200, recebido ${rDel.status}`);

    const dbRecord = await prisma.contract_services.findUnique({ where: { id: toRemoveId } });
    assert(dbRecord !== null, 'registro deve permanecer no banco');
    assert(dbRecord.active === false, `active deve ser false, recebido ${dbRecord.active}`);
  });

  // ─── SERVICES: CLOSED — bloqueado (Q4=A) ─────────────────────────────────

  await test('T48 — Adicionar serviço em CLOSED → 403 (bloqueado) [Q4=A]', async () => {
    closedSvcContractId = await createContract('CTR-SVC-CLOSED', testWorkId, testContractorId);
    await closeContract(closedSvcContractId);

    const r = await request('POST', `/api/contracts/${closedSvcContractId}/services`, {
      service_id: serviceId1, quantity: 10, unit_price: 5,
    }, adminToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'CONTRACT_CLOSED', `code: ${r.body.error.code}`);
  });

  await test('T49 — Atualizar serviço em CLOSED → 403 (bloqueado) [Q4=A]', async () => {
    // Criar serviço diretamente no banco (antes de fechar outro contrato) para ter um serviceId em CLOSED
    // Usaremos um contrato que criamos em DRAFT, adicionamos serviço, depois fechamos
    const toCloseId = await createContract('CTR-PATCH-CLOSED', testWorkId, testContractorId);
    const rSvc = await request('POST', `/api/contracts/${toCloseId}/services`, {
      service_id: serviceId1, quantity: 10, unit_price: 5,
    }, adminToken);
    assert(rSvc.status === 201, `criar serviço antes de fechar: ${rSvc.status}`);
    const svcId = rSvc.body.data.id;
    await closeContract(toCloseId);

    const r = await request('PATCH', `/api/contracts/${toCloseId}/services/${svcId}`, { quantity: 20 }, adminToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'CONTRACT_CLOSED', `code: ${r.body.error.code}`);
  });

  await test('T50 — Remover serviço em CLOSED → 403 (bloqueado) [Q4=A]', async () => {
    const toCloseId = await createContract('CTR-DEL-CLOSED', testWorkId, testContractorId);
    const rSvc = await request('POST', `/api/contracts/${toCloseId}/services`, {
      service_id: serviceId1, quantity: 10, unit_price: 5,
    }, adminToken);
    assert(rSvc.status === 201, `criar serviço antes de fechar: ${rSvc.status}`);
    const svcId = rSvc.body.data.id;
    await closeContract(toCloseId);

    const r = await request('DELETE', `/api/contracts/${toCloseId}/services/${svcId}`, null, adminToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'CONTRACT_CLOSED', `code: ${r.body.error.code}`);
  });

  // ─── Q5 — confirmação de active=false e persistência ─────────────────────

  await test('T51 — Remoção resulta em active=false; registro persiste no banco [Q5=B]', async () => {
    // T40 e T44 já verificaram isso; este teste confirma explicitamente via DB direto
    const removed = await prisma.contract_services.findFirst({
      where: { contract_id: draftSvcContractId, active: false },
    });
    assert(removed !== null, 'deve existir ao menos um registro com active=false no banco');
    assert(removed.active === false, `active deve ser false`);
  });

  // ─── requires_al em contract_services ────────────────────────────────────

  await test('T52 — contract_services não possui campo requires_al', async () => {
    // Verificar direto no banco
    const dbRecord = await prisma.contract_services.findFirst({
      where: { contract_id: draftSvcContractId },
    });
    assert(dbRecord !== null, 'deve existir registro');
    assert(!('requires_al' in dbRecord), 'requires_al não deve existir em contract_services');
  });

  await test('T53 — services.requires_al continua existindo', async () => {
    const svc = await prisma.services.findUnique({ where: { id: serviceId1 } });
    assert(svc !== null, 'serviço deve existir');
    assert('requires_al' in svc, 'requires_al deve existir em services');
    assert(typeof svc.requires_al === 'boolean', `requires_al deve ser boolean, é ${typeof svc.requires_al}`);
  });

  // ─── SALDO ────────────────────────────────────────────────────────────────

  await test('T54 — Consultar saldo → 200', async () => {
    const r = await request('GET', `/api/contracts/${activeSvcContractId}/balance`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    // Confirmar que nenhum item do saldo possui requires_al
    for (const item of r.body.data) {
      assert(!('requires_al' in item), `requires_al não deve estar no saldo: ${JSON.stringify(item)}`);
    }
  });

  // ─── AUTORIZAÇÃO CONTEXTUAL ───────────────────────────────────────────────

  await test('T55 — CONTRACTOR acessa somente seus contratos', async () => {
    const rList = await request('GET', '/api/contracts', null, contractorToken);
    assert(rList.status === 200, `esperado 200, recebido ${rList.status}`);
    for (const item of rList.body.items) {
      assert(item.contractor_id === testContractorId, `contractor_id incorreto: ${item.contractor_id}`);
    }
  });

  await test('T56 — CONTRACTOR não acessa contrato de outro empreiteiro → 404', async () => {
    const rList = await request('GET', '/api/contracts?work_id=' + testWorkId2, null, adminToken);
    if (rList.body.items && rList.body.items.length > 0) {
      const otherContractId = rList.body.items[0].id;
      const r = await request('GET', `/api/contracts/${otherContractId}`, null, contractorToken);
      assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    } else {
      console.log('       → (sem contrato de outro empreiteiro para testar)');
    }
  });

  await test('T57 — Fiscal acessa contratos da obra onde está vinculado', async () => {
    const rList = await request('GET', `/api/contracts?work_id=${testWorkId}`, null, fiscalToken);
    assert(rList.status === 200, `esperado 200, recebido ${rList.status}`);
    assert(Array.isArray(rList.body.items), 'items deve ser array');
  });

  await test('T58 — Fiscal não acessa contrato de obra não vinculada → 404', async () => {
    const rList = await request('GET', '/api/contracts?work_id=' + testWorkId2, null, adminToken);
    if (rList.body.items && rList.body.items.length > 0) {
      const otherId = rList.body.items[0].id;
      const r = await request('GET', `/api/contracts/${otherId}`, null, fiscalToken);
      assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    } else {
      console.log('       → (sem contrato na obra 2)');
    }
  });

  // ─── AUDITORIA ────────────────────────────────────────────────────────────

  await test('T59 — Auditoria CREATE_CONTRACT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'CREATE_CONTRACT', entity_type: 'contract' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log CREATE_CONTRACT não encontrado');
    assert(log.user_id === adminId, `user_id: ${log.user_id}`);
  });

  await test('T60 — Auditoria ACTIVATE_CONTRACT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'ACTIVATE_CONTRACT', entity_type: 'contract' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log ACTIVATE_CONTRACT não encontrado');
  });

  await test('T61 — Auditoria UPDATE_CONTRACT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'UPDATE_CONTRACT', entity_type: 'contract' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log UPDATE_CONTRACT não encontrado');
    assert(log.old_values !== null, 'old_values deve existir');
  });

  // ─── resultado ────────────────────────────────────────────────────────────

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

// ─── execução ────────────────────────────────────────────────────────────────

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
