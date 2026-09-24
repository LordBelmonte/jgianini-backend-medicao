'use strict';

require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
};

// Variáveis obrigatórias — o servidor não deve iniciar sem elas
const required = ['DATABASE_URL'];

for (const key of required) {
  if (!env[key]) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
}

module.exports = env;
