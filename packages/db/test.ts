import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findUnique({
    where: { id: 'cmujxdfgq0004mp01wjx5pvl4' },
    include: { review: true }
  });
  console.log('review:', job?.review ? 'exists' : 'null');
  if (job?.review) {
    console.log('findings isArray:', Array.isArray(job.review.findings));
    console.log('findings type:', typeof job.review.findings);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
