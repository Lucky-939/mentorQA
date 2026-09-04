const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.job.findFirst({ where: { id: 'cmtne4hpv000smp01ztpl76jr' }, include: { review: true } })
  .then(j => console.log(JSON.stringify(j.review.staticAnalysis, null, 2)))
  .finally(() => p.$disconnect());
