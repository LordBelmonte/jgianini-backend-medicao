'use strict';

/**
 * Middleware de Autenticação — JWT Stateless (DT-01)
 *
 * Referência: Documento 2 — seções 9, 10, 11
 *             Documento 4 — seção 3
 *             Documento 5 — seção 41 (hierarquia de autorização)
 *
 * Responsabilidades:
 *   1. Extrair o token do header Authorization: Bearer <token>
 *   2. Verificar assinatura e expiração do token
 *   3. Carregar o usuário do banco (garante que ainda existe e está ativo)
 *   4. Injetar req.user com dados do usuário para uso nas rotas protegidas
 *
 * Regras:
 *   - Token ausente ou inválido → 401 Unauthorized
 *   - Usuário inativo → 401 Unauthorized (Doc3 §6)
 *   - NÃO verifica permissões específicas aqui — isso é responsabilidade do
 *     permissionMiddleware, a ser criado na Etapa 5 (Perfis e Permissões)
 *
 * Nota: o frontend NÃO pode ser considerado mecanismo de segurança (Doc1 §3.2)
 */

const jwt    = require('jsonwebtoken');
const auth   = require('../config/auth');
const prisma = require('../config/prisma');

async function authenticate(req, res, next) {
  try {
    // 1. Extrair token do header
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code:    'MISSING_TOKEN',
          message: 'Token de autenticação não fornecido.',
        },
      });
    }

    const token = authHeader.slice(7); // remove "Bearer "

    // 2. Verificar assinatura e expiração
    let payload;
    try {
      payload = jwt.verify(token, auth.jwtSecret);
    } catch (jwtErr) {
      const isExpired = jwtErr.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        error: {
          code:    isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          message: isExpired
            ? 'Token expirado. Realize o login novamente.'
            : 'Token inválido.',
        },
      });
    }

    // 3. Carregar usuário do banco para garantir existência e status ativo
    const user = await prisma.users.findUnique({
      where: { id: payload.sub },
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
      return res.status(401).json({
        success: false,
        error: {
          code:    'USER_NOT_FOUND',
          message: 'Usuário não encontrado.',
        },
      });
    }

    // 4. Usuário inativo não pode operar (Doc3 §6)
    if (!user.active) {
      return res.status(401).json({
        success: false,
        error: {
          code:    'USER_INACTIVE',
          message: 'Usuário inativo. Entre em contato com o administrador.',
        },
      });
    }

    // 5. Montar req.user com dados necessários para as rotas e futuro permissionMiddleware
    const roles = user.user_roles.map(ur => ur.role.name);
    const permissions = [
      ...new Set(
        user.user_roles.flatMap(ur =>
          ur.role.role_permissions.map(rp => rp.permission.code)
        )
      ),
    ];

    req.user = {
      id:            user.id,
      name:          user.name,
      email:         user.email,
      active:        user.active,
      // contractor_id vem do banco (fonte confiável) — nunca do frontend
      // null para usuários internos (Admin, Fiscal, Coordinator, etc.)
      contractor_id: user.contractor_id ?? null,
      roles,
      permissions,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
