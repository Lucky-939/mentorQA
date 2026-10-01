import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findUnique({
    where: { id: 'cmujxdfgq0004mp01wjx5pvl4' },
    include: { review: true }
  });
  console.log(JSON.stringify(job, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
