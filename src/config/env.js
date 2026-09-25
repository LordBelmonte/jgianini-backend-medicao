'use strict';

require('dotenv').config();

const env = {
  NODE_ENV:       process.env.NODE_ENV || 'development',
  PORT:           parseInt(process.env.PORT, 10) || 3000,
  DATABASE_URL:   process.env.DATABASE_URL,
  // DT-01: JWT Stateless — decisão aprovada
  JWT_SECRET:     process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
};

// Variáveis obrigatórias — o servidor não deve iniciar sem elas
const required = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of required) {
  if (!env[key]) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
}

module.exports = env;
