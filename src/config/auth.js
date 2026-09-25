'use strict';

/**
 * Configuração centralizada de autenticação
 *
 * DT-01 — JWT Stateless (decisão aprovada)
 * Referência: Documento 4 — seção 3
 *
 * Regras:
 *   - Token enviado no header: Authorization: Bearer <token>
 *   - Expiração: 8 horas (JWT_EXPIRES_IN)
 *   - Segredo: JWT_SECRET (obrigatório no .env)
 *   - Payload mínimo: somente o necessário para identificar o usuário e verificar permissões
 *   - Senha: armazenada somente como bcrypt hash — nunca em texto puro (Doc3 §6)
 *   - Sem tabela de sessões — stateless
 */

const env = require('./env');

const auth = {
  jwtSecret:    env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  bcryptRounds: 12, // custo computacional adequado para produção
};

module.exports = auth;
