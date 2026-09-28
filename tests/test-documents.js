'use strict';
/**
 * T01 Sem token → 401
 * T02 Upload de documento → 201
 * T03 Upload com entity_type inválido → 400
 * T04 Upload sem file_name → 400
 * T05 Listar documentos por entidade → 200
 * T06 Buscar por ID → 200
 * T07 ID inexistente → 404
 * T08 Substituir documento → 200 (versão 2); anterior inativo
 * T09 Auditoria UPLOAD_DOCUMENT gerada
 */
require('dotenv').config();
const http   = require('http');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const app    = require('../src/app');

let server, port, adminToken, adminId, workId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...(token ? { 'Authorization': `Bearer ${token}` } : {}) } };
    const req = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); if (bodyStr) req.write(bodyStr); req.end();
  });
}
function assert(c, m) { if (!c) throw new Error(`FALHOU: ${m}`); }

async function setup() {
  const adminRole = await prisma.roles.findUnique({ where: { name: 'ADMIN' } });
  const perms = await prisma.permissions.findMany({ where: { code: { in: ['documents.view','documents.upload'] } } });
  for (const p of perms) await prisma.role_permissions.upsert({ where: { role_id_permission_id: { role_id: adminRole.id, permission_id: p.id } }, update: {}, create: { role_id: adminRole.id, permission_id: p.id } });

  const hash = await bcrypt.hash('Test@Doc123', 12);
  const admin = await prisma.users.create({ data: { name: '__DOC_ADMIN__', email: 'dadmin@doc.test', password_hash: hash, active: true } });
  adminId = admin.id;
  await prisma.user_roles.create({ data: { user_id: adminId, role_id: adminRole.id } });
  const work = await prisma.works.create({ data: { code: '__DOCW01__', name: 'Obra DOC', client_name: 'CLI', status: 'ACTIVE' } });
  workId = work.id;

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }); });
  const r = await request('POST', '/api/auth/login', { email: 'dadmin@doc.test', password: 'Test@Doc123' });
  adminToken = r.body.data.token;
}

async function teardown() {
  await prisma.documents.deleteMany({ where: { entity_id: workId } });
  await prisma.audit_logs.deleteMany({ where: { entity_id: workId } });
  await prisma.works.deleteMany({ where: { id: workId } });
  await prisma.user_roles.deleteMany({ where: { user_id: adminId } });
  await prisma.audit_logs.deleteMany({ where: { user_id: adminId } });
  await prisma.users.deleteMany({ where: { id: adminId } });
  server.close(); await prisma.$disconnect();
}

async function runTests() {
  console.log('=== TESTES — DOCUMENTOS ===\n');
  let passed = 0, failed = 0, docId;
  async function test(label, fn) {
    try { await fn(); console.log(`  ✅  ${label}`); passed++; }
    catch (e) { console.log(`  ❌  ${label}\n       → ${e.message}`); failed++; }
  }

  await test('T01 — Sem token → 401', async () => {
    const r = await request('GET', '/api/documents');
    assert(r.status === 401, `esperado 401, recebido ${r.status}`);
  });

  await test('T02 — Upload de documento → 201', async () => {
    const r = await request('POST', '/api/documents', { entity_type: 'work', entity_id: workId, file_name: 'contrato.pdf', file_path: '/uploads/contrato.pdf', mime_type: 'application/pdf', file_size: 102400 }, adminToken);
    assert(r.status === 201, `esperado 201, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.version === 1, `version: ${r.body.data.version}`);
    docId = r.body.data.id;
  });

  await test('T03 — Upload com entity_type inválido → 400', async () => {
    const r = await request('POST', '/api/documents', { entity_type: 'invalido', entity_id: workId, file_name: 'x.pdf', file_path: '/x.pdf', mime_type: 'application/pdf', file_size: 100 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T04 — Upload sem file_name → 400', async () => {
    const r = await request('POST', '/api/documents', { entity_type: 'work', entity_id: workId, file_path: '/x.pdf', mime_type: 'application/pdf', file_size: 100 }, adminToken);
    assert(r.status === 400, `esperado 400, recebido ${r.status}`);
  });

  await test('T05 — Listar documentos por entidade → 200', async () => {
    const r = await request('GET', `/api/documents?entity_type=work&entity_id=${workId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(Array.isArray(r.body.items), 'items deve ser array');
    assert(r.body.items.length >= 1, `deve ter >= 1 documento`);
  });

  await test('T06 — Buscar por ID → 200', async () => {
    const r = await request('GET', `/api/documents/${docId}`, null, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}`);
    assert(r.body.data.id === docId, 'id correto');
  });

  await test('T07 — ID inexistente → 404', async () => {
    const r = await request('GET', '/api/documents/00000000-0000-0000-0000-000000000000', null, adminToken);
    assert(r.status === 404, `esperado 404, recebido ${r.status}`);
  });

  await test('T08 — Substituir documento → versão 2; anterior inativo', async () => {
    const r = await request('POST', `/api/documents/${docId}/replace`, { file_name: 'contrato_v2.pdf', file_path: '/uploads/contrato_v2.pdf', mime_type: 'application/pdf', file_size: 204800 }, adminToken);
    assert(r.status === 200, `esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.version === 2, `version esperado 2, recebido ${r.body.data.version}`);
    const old = await prisma.documents.findUnique({ where: { id: docId } });
    assert(old.active === false, 'documento anterior deve estar inativo');
  });

  await test('T09 — Auditoria UPLOAD_DOCUMENT gerada', async () => {
    const log = await prisma.audit_logs.findFirst({ where: { action: 'UPLOAD_DOCUMENT' }, orderBy: { created_at: 'desc' } });
    assert(log !== null, 'audit UPLOAD_DOCUMENT não encontrado');
  });

  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

(async () => { try { await setup(); await runTests(); } catch (e) { console.error('ERRO FATAL:', e.message, e.stack); process.exitCode = 1; } finally { await teardown(); } })();
