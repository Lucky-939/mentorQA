const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.repository.findFirst().then(r => console.log(r)).finally(() => p.$disconnect());
