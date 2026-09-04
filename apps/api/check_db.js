const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.review.findMany({ orderBy: { createdAt: 'desc' }, take: 2 })
  .then(r => console.log(JSON.stringify(r.map(x => x.staticAnalysis), null, 2)))
  .finally(() => p.$disconnect());
