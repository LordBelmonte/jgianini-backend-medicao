'use strict';
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
console.log('PrismaClient instanciado:', typeof p);
const models = Object.keys(p).filter(k => !k.startsWith('_') && !k.startsWith('$'));
console.log('Models disponíveis (' + models.length + '):', models.join(', '));
p.$disconnect();
