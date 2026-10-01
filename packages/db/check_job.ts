import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { repository: true }
  });
  console.log(job);
}
main().catch(console.error).finally(() => prisma.$disconnect());
