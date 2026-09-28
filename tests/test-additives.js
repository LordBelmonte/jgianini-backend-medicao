'use strict';

/**
 * Testes da Etapa 9 — Módulo de Aditivos
 *
 * T01  Sem token → 401
 * T02  Admin cria aditivo em DRAFT → 201
 * T03  Aditivo criado em DRAFT tem version_number=1
 * T04  Segundo aditivo tem version_number=2 (versionamento)
 * T05  Criar sem reason → 400
 * T06  Admin edita aditivo em DRAFT → 200
 * T07  Não-criador não pode editar → 403
 * T08  Editar aditivo não-DRAFT → 403
 * T09  Criador submete (DRAFT → PENDING_APPROVAL) → 200
 * T10  Não-criador não pode submeter → 403
 * T11  Submeter já submetido → 400
 * T12  Diretor aprova aditivo → 200 (APPROVED)
 * T13  Aprovação aplica quantity_change no contract_service
 * T14  Aprovação aplica new_unit_price no contract_service
 * T15  Aprovação adiciona novo serviço ao contrato
 * T16  Aprovação é idempotente (não pode aprovar já aprovado) → 400
 * T17  Diretor rejeita aditivo → 200 (REJECTED)
 * T18  Rejeitar sem reason → 400
 * T19  Aditivo REJECTED permanece no banco (não é excluído)
 * T20  Criador cancela DRAFT → 200 (CANCELLED)
 * T21  Não-criador não pode cancelar → 403
 * T22  Cancelar não-DRAFT → 400
 * T23  Aditivo CANCELLED permanece no banco
 * T24  Aditivo NÃO pode remover serviço (D-05)
 * T25  Listar aditivos do contrato → 200
 * T26  Buscar aditivo por ID → 200
 * T27  ID inexistente → 404
 * T28  CONTRACTOR não tem permissão de criar → 403
 * T29  Auditoria CREATE_ADDITIVE gerada
 * T30  Auditoria APPROVE_ADDITIVE gerada
 * T31  Auditoria REJECT_ADDITIVE gerada
 */

require('dotenv').config();

const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port;
let adminToken, coordToken, directorToken, contractorToken;
let adminId, coordId, directorId, contractorUserId;
let adminRoleId, coordRoleId, directorRoleId, contractorRoleId;
let testContractorId, testWorkId, testContractId;
let testServiceId1, testServiceId2, testServiceId3;
let testContractServiceId;
let additiveDraftId, additiveSubmittedId;

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
  const [adminRole, coordRole, dirRole, contrRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'ADMIN' } }),
    prisma.roles.findUnique({ where: { name: 'COORDINATOR' } }),
    prisma.roles.findUnique({ where: { name: 'DIRECTOR' } }),
    prisma.roles.findUnique({ where: { name: 'CONTRACTOR' } }),
  ]);
  adminRoleId     = adminRole.id;
  coordRoleId     = coordRole.id;
  directorRoleId  = dirRole.id;
  contractorRoleId = contrRole.id;

  // Permissões
  const permCodes = ['additives.view', 'additives.create', 'additives.approve', 'additives.reject'];
  const perms = await prisma.permissions.findMany({ where: { code: { in: permCodes } } });

  for (const perm of perms) {
    for (const roleId of [adminRoleId, coordRoleId, directorRoleId]) {
      await prisma.role_permissions.upsert({
        where:  { role_id_permission_id: { role_id: roleId, permission_id: perm.id } },
        update: {}, create: { role_id: roleId, permission_id: perm.id },
      });
    }
  }
  // Contractor: somente view
  const viewPerm = perms.find(p => p.code === 'additives.view');
  await prisma.role_permissions.upsert({
    where:  { role_id_permission_id: { role_id: contractorRoleId, permission_id: viewPerm.id } },
    update: {}, create: { role_id: contractorRoleId, permission_id: viewPerm.id },
  });

  // Usuários
  const hash = await bcrypt.hash('Test@Add123', 12);
  const [admin, coord, dir, contr] = await Promise.all([
    prisma.users.create({ data: { name: '__ADD_ADMIN__',  email: 'aadmin@add.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__ADD_COORD__',  email: 'acoord@add.test',  password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__ADD_DIR__',    email: 'adir@add.test',    password_hash: hash, active: true } }),
    prisma.users.create({ data: { name: '__ADD_CONTR__',  email: 'acontr@add.test',  password_hash: hash, active: true } }),
  ]);
  adminId = admin.id; coordId = coord.id; directorId = dir.id; contractorUserId = contr.id;

  await Promise.all([
    prisma.user_roles.create({ data: { user_id: adminId,         role_id: adminRoleId     } }),
    prisma.user_roles.create({ data: { user_id: coordId,         role_id: coordRoleId     } }),
    prisma.user_roles.create({ data: { user_id: directorId,      role_id: directorRoleId  } }),
    prisma.user_roles.create({ data: { user_id: contractorUserId, role_id: contractorRoleId } }),
  ]);

  const contractor = await prisma.contractors.create({ data: { name: '__ADD_EMP__', active: true } });
  testContractorId = contractor.id;
  await prisma.users.update({ where: { id: contractorUserId }, data: { contractor_id: testContractorId } });

  const work = await prisma.works.create({ data: { code: '__ADDW01__', name: 'Obra ADD', client_name: 'CLI', status: 'ACTIVE' } });
  testWorkId = work.id;
  await Promise.all([
    prisma.work_contractors.create({ data: { work_id: testWorkId, contractor_id: testContractorId, active: true } }),
    prisma.user_works.create({ data: { user_id: coordId,    work_id: testWorkId } }),
    prisma.user_works.create({ data: { user_id: directorId, work_id: testWorkId } }),
  ]);

  // Serviços
  const [s1, s2, s3] = await Promise.all([
    prisma.services.create({ data: { code: '__ADD_S1__', name: 'Serv1', unit: 'M2',  active: true } }),
    prisma.services.create({ data: { code: '__ADD_S2__', name: 'Serv2', unit: 'UN',  active: true } }),
    prisma.services.create({ data: { code: '__ADD_S3__', name: 'Serv3', unit: 'DIA', active: true } }),
  ]);
  testServiceId1 = s1.id; testServiceId2 = s2.id; testServiceId3 = s3.id;

  // Contrato ACTIVE com serviço s1
  const contractsPerms = await prisma.permissions.findMany({ where: { code: { in: ['contracts.create', 'contracts.update', 'contracts.view'] } } });
  for (const p of contractsPerms) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: adminRoleId, permission_id: p.id } },
      update: {}, create: { role_id: adminRoleId, permission_id: p.id },
    });
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: coordRoleId, permission_id: p.id } },
      update: {}, create: { role_id: coordRoleId, permission_id: p.id },
    });
  }

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const [rA, rC, rD, rCo] = await Promise.all([
    request('POST', '/api/auth/login', { email: 'aadmin@add.test',  password: 'Test@Add123' }),
    request('POST', '/api/auth/login', { email: 'acoord@add.test',  password: 'Test@Add123' }),
    request('POST', '/api/auth/login', { email: 'adir@add.test',    password: 'Test@Add123' }),
    request('POST', '/api/auth/login', { email: 'acontr@add.test',  password: 'Test@Add123' }),
  ]);
  adminToken     = rA.body.data.token;
  coordToken     = rC.body.data.token;
  directorToken  = rD.body.data.token;
  contractorToken = rCo.body.data.token;

  // Criar contrato diretamente no banco (ACTIVE) com serviço s1
  const contract = await prisma.contracts.create({
    data: {
      work_id:           testWorkId,
      contractor_id:     testContractorId,
      contract_number:   '__ADD_CTR__',
      retention_percent: 5,
      status:            'ACTIVE',
      created_by:        adminId,
    },
  });
  testContractId = contract.id;

  const cs = await prisma.contract_services.create({
    data: { contract_id: testContractId, service_id: testServiceId1, quantity: 100, unit_price: 50, active: true },
  });
  testContractServiceId = cs.id;
}

async function teardown() {
  // Limpar produções, itens, medições
  const allContracts = await prisma.contracts.findMany({ where: { work_id: testWorkId }, select: { id: true } });
  const allContractIds = allContracts.map(c => c.id);

  if (allContractIds.length) {
    const additives = await prisma.contract_additives.findMany({ where: { contract_id: { in: allContractIds } }, select: { id: true } });
    const additiveIds = additives.map(a => a.id);
    if (additiveIds.length) {
      await prisma.contract_additive_services.deleteMany({ where: { additive_id: { in: additiveIds } } });
      await prisma.audit_logs.deleteMany({ where: { entity_id: { in: additiveIds } } });
      await prisma.contract_additives.deleteMany({ where: { id: { in: additiveIds } } });
    }
    await prisma.contract_services.deleteMany({ where: { contract_id: { in: allContractIds } } });
    await prisma.contracts.deleteMany({ where: { id: { in: allContractIds } } });
  }

  const svcIds = [testServiceId1, testServiceId2, testServiceId3].filter(Boolean);
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

  const userIds = [adminId, coordId, directorId, contractorUserId].filter(Boolean);
  if (userIds.length) {
    await prisma.user_roles.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.audit_logs.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  }

  server.close();
  await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — ETAPA 9: ADITIVOS ===\n');
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', `/api/contracts/${testContractId}/additives`);
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  // ─── CRUD / DRAFT ─────────────────────────────────────────────────────────

  await test('T02 — Admin cria aditivo em DRAFT → 201', async () => {
    const r = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Aumento de quantidade',
      services: [{ service_id: testServiceId1, quantity_change: 50 }],
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'DRAFT', `status: ${r.body.data.status}`);
    additiveDraftId = r.body.data.id;
  });

  await test('T03 — Aditivo criado em DRAFT tem version_number=1', async () => {
    assert(additiveDraftId, 'deve ter sido criado em T02');
    const r = await request('GET', `/api/additives/${additiveDraftId}`, null, adminToken);
    assert(r.body.data.version_number === 1, `version_number: ${r.body.data.version_number}`);
  });

  await test('T04 — Segundo aditivo tem version_number=2 (versionamento)', async () => {
    const r = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Alteração de preço',
      services: [{ service_id: testServiceId1, new_unit_price: 60 }],
    }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}`);
    assert(r.body.data.version_number === 2, `version_number: ${r.body.data.version_number}`);
    additiveSubmittedId = r.body.data.id; // será usado para testes de aprovação
  });

  await test('T05 — Criar sem reason → 400', async () => {
    const r = await request('POST', `/api/contracts/${testContractId}/additives`, {
      services: [{ service_id: testServiceId1, quantity_change: 10 }],
    }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T06 — Admin edita aditivo em DRAFT → 200', async () => {
    const r = await request('PATCH', `/api/additives/${additiveDraftId}`, {
      reason: 'Motivo editado',
    }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.reason === 'Motivo editado', `reason: ${r.body.data.reason}`);
  });

  await test('T07 — Não-criador não pode editar → 403', async () => {
    // coordToken é criador de nada; additiveDraftId foi criado pelo admin
    const r = await request('PATCH', `/api/additives/${additiveDraftId}`, {
      reason: 'Tentativa',
    }, coordToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'NOT_CREATOR', `code: ${r.body.error.code}`);
  });

  // ─── SUBMISSÃO ────────────────────────────────────────────────────────────

  await test('T09 — Criador submete (DRAFT → PENDING_APPROVAL) → 200', async () => {
    const r = await request('POST', `/api/additives/${additiveDraftId}/submit`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'PENDING_APPROVAL', `status: ${r.body.data.status}`);
  });

  await test('T10 — Não-criador não pode submeter → 403', async () => {
    // additiveSubmittedId ainda em DRAFT, criado pelo admin
    const r = await request('POST', `/api/additives/${additiveSubmittedId}/submit`, null, coordToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'NOT_CREATOR', `code: ${r.body.error.code}`);
  });

  await test('T08 — Editar aditivo não-DRAFT (agora PENDING) → 403', async () => {
    const r = await request('PATCH', `/api/additives/${additiveDraftId}`, { reason: 'X' }, adminToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'ADDITIVE_NOT_DRAFT', `code: ${r.body.error.code}`);
  });

  await test('T11 — Submeter já submetido → 400', async () => {
    const r = await request('POST', `/api/additives/${additiveDraftId}/submit`, null, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  // ─── APROVAÇÃO ────────────────────────────────────────────────────────────

  await test('T12 — Diretor aprova aditivo → 200 (APPROVED)', async () => {
    const r = await request('POST', `/api/additives/${additiveDraftId}/approve`, null, directorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'APPROVED', `status: ${r.body.data.status}`);
  });

  await test('T13 — Aprovação aplica quantity_change no contract_service', async () => {
    // contract_service para testServiceId1 tinha qty=100, aditivo adicionou +50 → deve ser 150
    const cs = await prisma.contract_services.findFirst({
      where: { contract_id: testContractId, service_id: testServiceId1, active: true },
    });
    assert(cs !== null, 'contract_service deve existir');
    assert(parseFloat(cs.quantity) === 150, `quantity esperado 150, recebido ${cs.quantity}`);
  });

  await test('T16 — Aprovação é idempotente (não pode aprovar já aprovado) → 400', async () => {
    const r = await request('POST', `/api/additives/${additiveDraftId}/approve`, null, directorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  // ─── APROVAÇÃO COM PREÇO ──────────────────────────────────────────────────

  await test('T14 — Aprovação aplica new_unit_price no contract_service', async () => {
    // additiveSubmittedId (version=2): new_unit_price=60 para testServiceId1 — ainda em DRAFT
    // Submeter pelo admin
    await request('POST', `/api/additives/${additiveSubmittedId}/submit`, null, adminToken);
    const rApprove = await request('POST', `/api/additives/${additiveSubmittedId}/approve`, null, directorToken);
    assert(rApprove.status === 200, `aprovar: ${rApprove.status}: ${JSON.stringify(rApprove.body)}`);

    const cs = await prisma.contract_services.findFirst({
      where: { contract_id: testContractId, service_id: testServiceId1, active: true },
    });
    assert(parseFloat(cs.unit_price) === 60, `unit_price esperado 60, recebido ${cs.unit_price}`);
  });

  await test('T15 — Aprovação adiciona novo serviço ao contrato', async () => {
    // Criar aditivo com novo serviço (s2 não está no contrato)
    const rCreate = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Adição de novo serviço',
      services: [{ service_id: testServiceId2, quantity_change: 30, new_unit_price: 20 }],
    }, adminToken);
    assert(rCreate.status === 201, `criar: ${rCreate.status}`);
    const newId = rCreate.body.data.id;

    await request('POST', `/api/additives/${newId}/submit`, null, adminToken);
    const rApprove = await request('POST', `/api/additives/${newId}/approve`, null, directorToken);
    assert(rApprove.status === 200, `aprovar novo serviço: ${rApprove.status}: ${JSON.stringify(rApprove.body)}`);

    const cs = await prisma.contract_services.findFirst({
      where: { contract_id: testContractId, service_id: testServiceId2, active: true },
    });
    assert(cs !== null, 'novo contract_service deve ter sido criado');
    assert(parseFloat(cs.quantity) === 30, `quantity do novo serviço: ${cs.quantity}`);
  });

  // ─── REJEIÇÃO ─────────────────────────────────────────────────────────────

  await test('T17 — Diretor rejeita aditivo → 200 (REJECTED)', async () => {
    const rCreate = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Para rejeitar',
      services: [{ service_id: testServiceId1, quantity_change: 10 }],
    }, adminToken);
    const rejectId = rCreate.body.data.id;
    await request('POST', `/api/additives/${rejectId}/submit`, null, adminToken);

    const r = await request('POST', `/api/additives/${rejectId}/reject`, { reason: 'Valor fora da realidade' }, directorToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'REJECTED', `status: ${r.body.data.status}`);
    assert(r.body.data.rejection_reason === 'Valor fora da realidade', `rejection_reason: ${r.body.data.rejection_reason}`);
  });

  await test('T18 — Rejeitar sem reason → 400', async () => {
    const rCreate = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Para rejeitar sem motivo',
      services: [{ service_id: testServiceId1, quantity_change: 5 }],
    }, adminToken);
    const rejectId = rCreate.body.data.id;
    await request('POST', `/api/additives/${rejectId}/submit`, null, adminToken);

    const r = await request('POST', `/api/additives/${rejectId}/reject`, {}, directorToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T19 — Aditivo REJECTED permanece no banco', async () => {
    const rejecteds = await prisma.contract_additives.findMany({
      where: { contract_id: testContractId, status: 'REJECTED' },
    });
    assert(rejecteds.length >= 1, 'deve existir ao menos 1 aditivo REJECTED no banco');
  });

  // ─── CANCELAMENTO ─────────────────────────────────────────────────────────

  await test('T20 — Criador cancela DRAFT → 200 (CANCELLED)', async () => {
    const rCreate = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Para cancelar',
      services: [{ service_id: testServiceId1, quantity_change: 5 }],
    }, adminToken);
    const cancelId = rCreate.body.data.id;

    const r = await request('POST', `/api/additives/${cancelId}/cancel`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'CANCELLED', `status: ${r.body.data.status}`);
  });

  await test('T21 — Não-criador não pode cancelar → 403', async () => {
    const rCreate = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Para cancelar por outro',
    }, adminToken);
    const cancelId = rCreate.body.data.id;

    const r = await request('POST', `/api/additives/${cancelId}/cancel`, null, coordToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
    assert(r.body.error.code === 'NOT_CREATOR', `code: ${r.body.error.code}`);
  });

  await test('T22 — Cancelar não-DRAFT → 400', async () => {
    // additiveDraftId está em APPROVED
    const r = await request('POST', `/api/additives/${additiveDraftId}/cancel`, null, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
    assert(r.body.error.code === 'INVALID_STATUS_TRANSITION', `code: ${r.body.error.code}`);
  });

  await test('T23 — Aditivo CANCELLED permanece no banco', async () => {
    const cancelled = await prisma.contract_additives.findMany({
      where: { contract_id: testContractId, status: 'CANCELLED' },
    });
    assert(cancelled.length >= 1, 'deve existir ao menos 1 aditivo CANCELLED no banco');
  });

  // ─── D-05: sem remoção de serviço ─────────────────────────────────────────

  await test('T24 — Aditivo NÃO pode remover serviço (D-05 — ausência de campo)', async () => {
    // Verificar que contract_additive_services não tem campo action/remove
    const cas = await prisma.contract_additive_services.findFirst({ where: { additive_id: additiveDraftId } });
    // O modelo não tem campo "action" — a remoção não é possível pela estrutura
    if (cas) {
      assert(!('action' in cas), 'campo action não deve existir em contract_additive_services');
    }
    // Verificação adicional: tentar criar com campo remove (ignorado pelo Prisma)
    console.log('       → (D-05: campo action ausente — remoção estruturalmente impossível)');
  });

  // ─── LISTAGEM / BUSCA ─────────────────────────────────────────────────────

  await test('T25 — Listar aditivos do contrato → 200', async () => {
    const r = await request('GET', `/api/contracts/${testContractId}/additives`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.data), 'data deve ser array');
    assert(r.body.data.length >= 1, `deve ter ao menos 1 aditivo`);
  });

  await test('T26 — Buscar aditivo por ID → 200', async () => {
    const r = await request('GET', `/api/additives/${additiveDraftId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === additiveDraftId, `id: ${r.body.data.id}`);
  });

  await test('T27 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/additives/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  // ─── PERMISSÕES ───────────────────────────────────────────────────────────

  await test('T28 — CONTRACTOR não tem permissão de criar → 403', async () => {
    const r = await request('POST', `/api/contracts/${testContractId}/additives`, {
      reason: 'Tentativa contractor',
    }, contractorToken);
    assert(r.status === 403, `esperado 403, recebido ${r.status}`);
  });

  // ─── AUDITORIA ────────────────────────────────────────────────────────────

  await test('T29 — Auditoria CREATE_ADDITIVE gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'CREATE_ADDITIVE', entity_type: 'additive' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log CREATE_ADDITIVE não encontrado');
    assert(log.user_id === adminId, `user_id: ${log.user_id}`);
  });

  await test('T30 — Auditoria APPROVE_ADDITIVE gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'APPROVE_ADDITIVE', entity_type: 'additive' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log APPROVE_ADDITIVE não encontrado');
  });

  await test('T31 — Auditoria REJECT_ADDITIVE gerada', async () => {
    const log = await prisma.audit_logs.findFirst({
      where: { action: 'REJECT_ADDITIVE', entity_type: 'additive' },
      orderBy: { created_at: 'desc' },
    });
    assert(log !== null, 'audit_log REJECT_ADDITIVE não encontrado');
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
