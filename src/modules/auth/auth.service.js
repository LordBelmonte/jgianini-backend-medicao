'use strict';

/**
 * Service de Autenticação
 *
 * DT-01 — JWT Stateless
 * Referência: Documento 4 — seções 8.1, 8.2, 8.3
 *             Documento 2 — seções 10, 11
 *             Documento 3 — §6 (users)
 *
 * Responsabilidades:
 *   - Verificar credenciais (email + senha)
 *   - Verificar se o usuário está ativo (Doc3 §6: "usuário inativo não deve conseguir autenticar")
 *   - Gerar o token JWT
 *   - Retornar dados do usuário autenticado
 *
 * NÃO contém regras de negócio além da autenticação.
 * NÃO verifica permissões aqui — isso é responsabilidade do permissionMiddleware (Etapa 5).
 */

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const auth    = require('../../config/auth');
const prisma  = require('../../config/prisma');

/**
 * Payload mínimo do JWT.
 * Contém somente o necessário para identificar o usuário nas requisições subsequentes.
 * O carregamento completo de perfis/permissões ocorre no middleware authenticate.
 *
 * @param {object} user - registro do banco
 * @returns {object} payload
 */
function buildPayload(user) {
  return {
    sub: user.id,   // identificador estável do usuário
    email: user.email,
  };
}

/**
 * Realiza o login: valida credenciais e retorna token + dados do usuário.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ user: object, token: string, expiresIn: string }}
 */
async function login(email, password) {
  // 1. Buscar usuário pelo email
  const user = await prisma.users.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      user_roles: {
        include: {
          role: {
            include: {
              role_permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });

  // 2. Usuário não encontrado — mesma mensagem para não revelar existência do e-mail
  if (!user) {
    const err = new Error('Credenciais inválidas.');
    err.statusCode = 401;
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  // 3. Usuário inativo não pode autenticar (Doc3 §6)
  if (!user.active) {
    const err = new Error('Usuário inativo. Entre em contato com o administrador.');
    err.statusCode = 401;
    err.code = 'USER_INACTIVE';
    throw err;
  }

  // 4. Verificar senha
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    const err = new Error('Credenciais inválidas.');
    err.statusCode = 401;
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  // 5. Gerar token JWT
  const payload = buildPayload(user);
  const token = jwt.sign(payload, auth.jwtSecret, {
    expiresIn: auth.jwtExpiresIn,
  });

  // 6. Montar resposta — perfis e permissões incluídos para uso no frontend
  const roles = user.user_roles.map(ur => ur.role.name);
  const permissions = [
    ...new Set(
      user.user_roles.flatMap(ur =>
        ur.role.role_permissions.map(rp => rp.permission.code)
      )
    ),
  ];

  return {
    user: {
      id:    user.id,
      name:  user.name,
      email: user.email,
    },
    roles,
    permissions,
    token,
    expiresIn: auth.jwtExpiresIn,
  };
}

/**
 * Retorna os dados completos do usuário autenticado.
 * Chamado pelo endpoint GET /api/auth/me após o middleware authenticate.
 *
 * @param {string} userId - id do usuário autenticado (vem do token validado)
 * @returns {object} dados do usuário
 */
async function getMe(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      user_roles: {
        include: {
          role: {
            include: {
              role_permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    const err = new Error('Usuário não encontrado.');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  if (!user.active) {
    const err = new Error('Usuário inativo.');
    err.statusCode = 401;
    err.code = 'USER_INACTIVE';
    throw err;
  }

  const roles = user.user_roles.map(ur => ur.role.name);
  const permissions = [
    ...new Set(
      user.user_roles.flatMap(ur =>
        ur.role.role_permissions.map(rp => rp.permission.code)
      )
    ),
  ];

  return {
    id:          user.id,
    name:        user.name,
    email:       user.email,
    active:      user.active,
    roles,
    permissions,
  };
}

/**
 * Hash de senha — utilitário para uso no seed/criação de usuários (Etapa 4).
 * @param {string} plainPassword
 * @returns {Promise<string>} hash
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, auth.bcryptRounds);
}

module.exports = { login, getMe, hashPassword };
