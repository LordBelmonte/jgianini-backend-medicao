'use strict';

/**
 * Testes da Etapa 3 — Autenticação JWT
 *
 * Cenários cobertos:
 *   T01 — Servidor inicia corretamente
 *   T02 — Login com credenciais inválidas retorna 401
 *   T03 — Login com email inexistente retorna 401
 *   T04 — Login com body incompleto retorna 400
 *   T05 — Login com credenciais corretas retorna 200 + token
 *   T06 — Token gerado é válido e contém payload correto
 *   T07 — GET /api/auth/me sem token retorna 401
 *   T08 — GET /api/auth/me com token inválido retorna 401
 *   T09 — GET /api/auth/me com token válido retorna dados do usuário
 *   T10 — POST /api/auth/logout com token válido retorna 200
 *   T11 — POST /api/auth/logout sem token retorna 401
 *   T12 — Usuário inativo não consegue autenticar
 */

require('dotenv').config();

const http    = require('http');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const prisma  = require('../src/config/prisma');
const app     = require('../src/app');

// ─── helpers ─────────────────────────────────────────────────────────────────

let server;
let port;
let testUserId;
let testUserInactiveId;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
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

// ─── setup ────────────────────────────────────────────────────────────────────

async function setup() {
  // Criar usuário de teste ativo
  const hash = await bcrypt.hash('Senha@Teste123', 12);
  const user = await prisma.users.create({
    data: {
      name: '__TEST_USER__',
      email: 'test@jgianini.test',
      password_hash: hash,
      active: true,
    },
  });
  testUserId = user.id;

  // Criar usuário inativo
  const hashInactive = await bcrypt.hash('Senha@Teste123', 12);
  const inactive = await prisma.users.create({
    data: {
      name: '__TEST_INACTIVE__',
      email: 'inactive@jgianini.test',
      password_hash: hashInactive,
      active: false,
    },
  });
  testUserInactiveId = inactive.id;

  // Iniciar servidor em porta aleatória
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  // Remover usuários de teste
  await prisma.users.deleteMany({
    where: { id: { in: [testUserId, testUserInactiveId].filter(Boolean) } },
  });
  server.close();
  await prisma.$disconnect();
}

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== TESTES — ETAPA 3: AUTENTICAÇÃO JWT ===\n');
  let passed = 0;
  let failed = 0;
  let token;

  async function test(label, fn) {
    try {
      await fn();
      console.log(`  ✅  ${label}`);
      passed++;
    } catch (err) {
      console.log(`  ❌  ${label}`);
      console.log(`       → ${err.message}`);
      failed++;
    }
  }

  // T01 — servidor responde
  await test('T01 — Servidor respondendo', async () => {
    const res = await request('GET', '/api/health');
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
  });

  // T02 — login com senha errada
  await test('T02 — Login com senha incorreta → 401', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'test@jgianini.test',
      password: 'senhaErrada',
    });
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.success === false, 'success deve ser false');
    assert(res.body.error.code === 'INVALID_CREDENTIALS', `code: ${res.body.error.code}`);
  });

  // T03 — login com email inexistente
  await test('T03 — Login com email inexistente → 401', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'naoexiste@jgianini.test',
      password: 'qualquer',
    });
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.error.code === 'INVALID_CREDENTIALS', `code: ${res.body.error.code}`);
  });

  // T04 — body incompleto
  await test('T04 — Login sem password → 400', async () => {
    const res = await request('POST', '/api/auth/login', { email: 'test@jgianini.test' });
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `code: ${res.body.error.code}`);
  });

  // T04b — email inválido
  await test('T04b — Login com email inválido → 400', async () => {
    const res = await request('POST', '/api/auth/login', { email: 'nao-e-email', password: '123' });
    assert(res.status === 400, `esperado 400, recebido ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `code: ${res.body.error.code}`);
  });

  // T05 — login correto
  await test('T05 — Login com credenciais corretas → 200 + token', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'test@jgianini.test',
      password: 'Senha@Teste123',
    });
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
    assert(res.body.data.token, 'token deve estar presente');
    assert(res.body.data.user.email === 'test@jgianini.test', 'email incorreto');
    assert(Array.isArray(res.body.data.roles), 'roles deve ser array');
    assert(Array.isArray(res.body.data.permissions), 'permissions deve ser array');
    token = res.body.data.token;
  });

  // T06 — payload do token
  await test('T06 — Payload JWT contém sub e email corretos', async () => {
    assert(token, 'token não foi obtido no T05');
    const env = require('../src/config/env');
    const decoded = jwt.verify(token, env.JWT_SECRET);
    assert(decoded.sub === testUserId, `sub incorreto: ${decoded.sub}`);
    assert(decoded.email === 'test@jgianini.test', `email incorreto: ${decoded.email}`);
    assert(decoded.exp, 'exp deve estar presente');
    const diffHours = (decoded.exp - decoded.iat) / 3600;
    assert(Math.abs(diffHours - 8) < 0.1, `expiração deve ser ~8h, recebido ${diffHours.toFixed(2)}h`);
  });

  // T07 — /me sem token
  await test('T07 — GET /api/auth/me sem token → 401', async () => {
    const res = await request('GET', '/api/auth/me');
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.error.code === 'MISSING_TOKEN', `code: ${res.body.error.code}`);
  });

  // T08 — /me com token inválido
  await test('T08 — GET /api/auth/me com token inválido → 401', async () => {
    const res = await request('GET', '/api/auth/me', null, 'token.invalido.aqui');
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.error.code === 'INVALID_TOKEN', `code: ${res.body.error.code}`);
  });

  // T09 — /me com token válido
  await test('T09 — GET /api/auth/me com token válido → 200 + dados', async () => {
    assert(token, 'token não foi obtido no T05');
    const res = await request('GET', '/api/auth/me', null, token);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
    assert(res.body.data.id === testUserId, 'id incorreto');
    assert(res.body.data.email === 'test@jgianini.test', 'email incorreto');
  });

  // T10 — logout com token válido
  await test('T10 — POST /api/auth/logout com token válido → 200', async () => {
    assert(token, 'token não foi obtido no T05');
    const res = await request('POST', '/api/auth/logout', null, token);
    assert(res.status === 200, `esperado 200, recebido ${res.status}`);
    assert(res.body.success === true, 'success deve ser true');
  });

  // T11 — logout sem token
  await test('T11 — POST /api/auth/logout sem token → 401', async () => {
    const res = await request('POST', '/api/auth/logout');
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
  });

  // T12 — usuário inativo
  await test('T12 — Login com usuário inativo → 401', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'inactive@jgianini.test',
      password: 'Senha@Teste123',
    });
    assert(res.status === 401, `esperado 401, recebido ${res.status}`);
    assert(res.body.error.code === 'USER_INACTIVE', `code: ${res.body.error.code}`);
  });

  // ─── resultado ──────────────────────────────────────────────────────────────
  console.log(`\n=== RESULTADO: ${passed} passaram | ${failed} falharam ===`);
  if (failed > 0) process.exitCode = 1;
}

// ─── execução ────────────────────────────────────────────────────────────────

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
