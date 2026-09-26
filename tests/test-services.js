'use strict';

/**
 * Testes da Etapa 7 — Módulo de Serviços
 *
 * T01  Sem token → 401
 * T02  Admin cria serviço M2 com requires_al=true → 201
 * T03  Admin cria serviço UN → 201
 * T04  Admin cria serviço DIA → 201
 * T05  Admin cria com code duplicado → 409
 * T06  Admin cria sem name → 400
 * T07  Admin cria sem code → 400
 * T08  Admin cria com unit inválida → 400
 * T09  Admin lista todos → 200 + paginação
 * T10  Admin filtra por unit=M2 → retorna somente M2
 * T11  Admin filtra por active=false → lista vazia (nenhum inativo ainda)
 * T12  CONTRACTOR sem contractor_id lista → lista vazia
 * T13  CONTRACTOR com contratos lista → somente serviços de seus contratos
 * T14  Admin busca por ID → 200
 * T15  ID inexistente → 404
 * T16  CONTRACTOR busca serviço fora de seus contratos → 403
 * T17  Admin atualiza name → 200
 * T18  Admin atualiza code para duplicado → 409
 * T19  Fiscal tenta criar → 403
 * T20  Fiscal tenta atualizar → 403
 * T21  Admin inativa serviço → active=false
 * T22  Admin ativa serviço → active=true
 * T23  Inativar já ativo → 409 STATUS_UNCHANGED
 * T24  Listagem filtrada por active=false mostra inativado
 * T25  Criação auditada (CREATE_SERVICE)
 * T26  Atualização auditada (old/new values)
 * T27  Inativação auditada (DISABLE_SERVICE)
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

// ─── helpers ─────────────────────────────────────────────────────────────────

let server, port;
let adminToken, fiscalToken, contractorToken;
let adminId, fiscalId, contractorUserId;
let adminRoleId, fiscalRoleId, contractorRoleId;
let testContractorId, testWorkId, testContractId;
let svcM2Id, svcUNId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token  ? { 'Authorization': `Bearer ${token}` } : {}),
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

// ─── setup ───────────────────────────────────────────────────────────────────

async function setup() {
  const [adminRole, fiscalRole, contractorRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'FISCAL' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId      = adminRole.id;
  fiscalRoleId     = fiscalRole.id;
  contractorRoleId = contractorRole.id;

  // Atribuir permissões de serviços
  const permCodes = ['services.view', 'services.create', 'services.update'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: adminRoleId, permission_id: perm.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: perm.id },
    });
  }
  const viewPerm = perms.find(p => p.code === 'services.view');
  for (const roleId of [fiscalRoleId, contractorRoleId]) {
    await prisma.role_permissions.upsert({
      where:  { role_id_permission_id: { role_id: roleId, permission_id: viewPerm.id } },
      update: {}, create: { role_id: roleId, permission_id: viewPerm.id },
    });
  }

  // Criar usuários de teste
  const hash = await bcrypt.hash('Test@Svc123', 12);
  const [admin, fiscal, contUser] = await Promise.all([
    prisma.users.create({ data: { name: '__SVC_ADMIN__',  email: 'sadmin@svc.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__SVC_FISCAL__', email: 'sfiscal@svc.test', password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__SVC_CONTR__',  email: 'scontr@svc.test',  password_hash: hash, active: true } }),
  ]);
  adminId          = admin.id;
  fiscalId         = fiscal.id;
  contractorUserId = contUser.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,          role_id: adminRoleId      } }),
    prisma.user_roles.create({ data: { user_id: fiscalId,         role_id: fiscalRoleId     } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId } }),
  ]);

  // Criar empreiteiro e vincular ao usuário CONTRACTOR
  const contr = await prisma.contractors.create({ data: { name: '__SVC_EMPREITEIRO__', active: true } });
  testContractorId = contr.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  // Criar obra de teste
  const work = await prisma.works.create({
    data: { code: '__SVCTEST__W01', name: 'Obra SVC', client_name: 'Cliente', status: 'ACTIVE' },
  });
  testWorkId = work.id;
  await prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } });

  // Iniciar servidor
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  // Tokens
  const [rA, rF, rC] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'sadmin@svc.test',  password: 'Test@Svc123' }),
    request('POST', '/api/auth/login', { email: 'sfiscal@svc.test', password: 'Test@Svc123' }),
    request('POST', '/api/auth/login', { email: 'scontr@svc.test',  password: 'Test@Svc123' }),
  ]);
  adminToken      = rA.body.data.token;
  fiscalToken     = rF.body.data.token;
  contractorToken = rC.body.data.token;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  const ids = [adminId, fiscalId, contractorUserId].filter(Boolean);

  // Limpar serviços de teste
  const svcIds = [svcM2Id, svcUNId].filter(Boolean);
  const testSvcs = await prisma.services.findMany({ where: { code: { startsWith: '__SVC__' } }, select: { id: true } });
  const allSvcIds = [...new Set([...svcIds, ...testSvcs.map(s => s.id)])];

  if (allSvcIds.length) {
    await prisma.contract_services.deleteMany({ where: { service_id: { in: allSvcIds } } });
    await prisma.audit_logs.deleteMany({ where: { entity_id: { in: allSvcIds } } });
    await prisma.services.deleteMany({ where: { id: { in: allSvcIds } } });
  }

  if (testContractId) {
    await prisma.contracts.deleteMany({ where: { id: testContractId } });
  }

  if (testWorkId) {
    await prisma.work_contractors.deleteMany({ where: { work_id: testWorkId } });
    await prisma.user_works.deleteMany({ where: { work_id: testWorkId } });
    await prisma.works.deleteMany({ where: { id: testWorkId } });
  }

  if (testContractorId) {
    await prisma.users.updateMany({ where: { contractor_id: testContractorId }, data: { contractor_id: null } });
    await prisma.contractors.deleteMany({ where: { id: testContractorId } });
  }

  if (ids.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  }

  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 7: SERVIÇOS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/services');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Admin cria serviço M2 com requires_al=true → 201', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__CM', name: 'Contramarco', unit: 'M2', requiresAl: true }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.code === '__SVC__CM', `code: ${r.body.data.code}`);
    assert(r.body.data.unit === 'M2', `unit: ${r.body.data.unit}`);
    assert(r.body.data.requires_al === true, 'requires_al deve ser true');
    svcM2Id = r.body.data.id;
  });

  await test('T03 — Admin cria serviço UN → 201', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__UN', name: 'Serviço UN', unit: 'UN' }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.unit === 'UN', `unit: ${r.body.data.unit}`);
    assert(r.body.data.requires_al === false, 'requires_al default deve ser false');
    svcUNId = r.body.data.id;
  });

  await test('T04 — Admin cria serviço DIA → 201', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__DIA', name: 'Serviço DIA', unit: 'DIA' }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.unit === 'DIA', `unit: ${r.body.data.unit}`);
    // Limpar imediatamente
    await prisma.audit_logs.deleteMany({ where: { entity_id: r.body.data.id } });
    await prisma.services.delete({ where: { id: r.body.data.id } });
  });

  await test('T05 — Admin cria com code duplicado → 409', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__CM', name: 'Dup', unit: 'M2' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CODE_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T06 — Admin cria sem name → 400', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__X', unit: 'M2' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'VALIDATION_ERROR', `code: ${r.body.error.code}`);
  });

  await test('T07 — Admin cria sem code → 400', async () => {
    const r = await request('POST', '/api/services',
      { name: 'Sem Code', unit: 'M2' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T08 — Admin cria com unit inválida → 400', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__Y', name: 'Unit Inválida', unit: 'KG' }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T09 — Admin lista todos → 200 + paginação', async () => {
    const r = await request('GET', '/api/services', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.pagination, 'paginação deve estar presente');
    assert(r.body.pagination.total >= 2, 'deve ter pelo menos 2 serviços');
  });

  await test('T10 — Admin filtra por unit=M2 → somente M2', async () => {
    const r = await request('GET', '/api/services?unit=M2', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.every(s => s.unit === 'M2'), 'todos devem ser M2');
  });

  await test('T11 — Admin filtra por active=false → lista vazia (nenhum inativo ainda)', async () => {
    const r = await request('GET', '/api/services?active=false', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    const hasTestSvcs = r.body.data.some(s => s.id === svcM2Id || s.id === svcUNId);
    assert(!hasTestSvcs, 'serviços ativos não devem aparecer no filtro active=false');
  });

  await test('T12 — CONTRACTOR sem contratos lista → lista vazia', async () => {
    // contractorToken vinculado a testContractorId, mas sem contratos com serviços
    const r = await request('GET', '/api/services', null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.pagination.total === 0, `esperado 0, recebido ${r.body.pagination.total}`);
  });

  await test('T13 — CONTRACTOR com contrato lista → somente serviços do contrato', async () => {
    // Criar contrato com os serviços de teste
    const retentionPercent = 5;
    const contract = await prisma.contracts.create({
      data: {
        work_id:          testWorkId,
        contractor_id:    testContractorId,
        contract_number:  '__SVC_CONTRACT__',
        retention_percent: retentionPercent,
        status:           'ACTIVE',
        created_by:       adminId,   // Etapa 8: campo obrigatório
        contract_services: {
          create: [
            { service_id: svcM2Id, quantity: 100, unit_price: 120 },
          ],
        },
      },
    });
    testContractId = contract.id;

    const r = await request('GET', '/api/services', null, contractorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.pagination.total === 1, `esperado 1, recebido ${r.body.pagination.total}`);
    assert(r.body.data[0].id === svcM2Id, 'deve ser o serviço do contrato');
  });

  await test('T14 — Admin busca serviço por ID → 200', async () => {
    assert(svcM2Id, 'svcM2Id não definido');
    const r = await request('GET', `/api/services/${svcM2Id}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === svcM2Id, 'id incorreto');
  });

  await test('T15 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/services/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
    assert(r.body.error.code === 'SERVICE_NOT_FOUND', `code: ${r.body.error.code}`);
  });

  await test('T16 — CONTRACTOR busca serviço fora de seus contratos → 403', async () => {
    // svcUNId não está no contrato do CONTRACTOR
    const r = await request('GET', `/api/services/${svcUNId}`, null, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T17 — Admin atualiza name → 200', async () => {
    const r = await request('PATCH', `/api/services/${svcM2Id}`,
      { name: 'Contramarco Atualizado' }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.name === 'Contramarco Atualizado', `name: ${r.body.data.name}`);
  });

  await test('T18 — Admin atualiza code para duplicado → 409', async () => {
    const r = await request('PATCH', `/api/services/${svcM2Id}`,
      { code: '__SVC__UN' }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'CODE_ALREADY_EXISTS', `code: ${r.body.error.code}`);
  });

  await test('T19 — Fiscal tenta criar → 403', async () => {
    const r = await request('POST', '/api/services',
      { code: '__SVC__FISCAL', name: 'Fiscal Criar', unit: 'M2' }, fiscalToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T20 — Fiscal tenta atualizar → 403', async () => {
    const r = await request('PATCH', `/api/services/${svcM2Id}`,
      { name: 'Fiscal Atualizar' }, fiscalToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'FORBIDDEN', `code: ${r.body.error.code}`);
  });

  await test('T21 — Admin inativa serviço → active=false', async () => {
    const r = await request('PATCH', `/api/services/${svcUNId}/status`,
      { active: false }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.active === false, 'deve estar inativo');
  });

  await test('T22 — Admin ativa serviço → active=true', async () => {
    const r = await request('PATCH', `/api/services/${svcUNId}/status`,
      { active: true }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.active === true, 'deve estar ativo');
  });

  await test('T23 — Inativar já ativo → 409 STATUS_UNCHANGED', async () => {
    const r = await request('PATCH', `/api/services/${svcUNId}/status`,
      { active: true }, adminToken);
    assert(r.status === 409, `esperado 409, recebido ${r.status}`);
    assert(r.body.error.code === 'STATUS_UNCHANGED', `code: ${r.body.error.code}`);
  });

  await test('T24 — Listagem active=false mostra inativado', async () => {
    // Inativar svcUNId
    await request('PATCH', `/api/services/${svcUNId}/status`, { active: false }, adminToken);
    const r = await request('GET', '/api/services?active=false', null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.some(s => s.id === svcUNId), 'svcUN deve aparecer na listagem de inativos');
    // Reativar para limpeza posterior
    await request('PATCH', `/api/services/${svcUNId}/status`, { active: true }, adminToken);
  });

  await test('T25 — Criação auditada (CREATE_SERVICE)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: svcM2Id, action: 'CREATE_SERVICE' },
    });
    assert(log !== null, 'log CREATE_SERVICE não encontrado');
    assert(log.user_id === adminId, 'actor incorreto');
  });

  await test('T26 — Atualização auditada (UPDATE_SERVICE + old/new values)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: svcM2Id, action: 'UPDATE_SERVICE' },
    });
    assert(log !== null, 'log UPDATE_SERVICE não encontrado');
    assert(log.old_values !== null, 'old_values deve estar presente');
    assert(log.new_values !== null, 'new_values deve estar presente');
  });

  await test('T27 — Inativação auditada (DISABLE_SERVICE)', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { entity_id: svcUNId, action: 'DISABLE_SERVICE' },
    });
    assert(log !== null, 'log DISABLE_SERVICE não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('ERRO FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await teardown();
  }
})();
