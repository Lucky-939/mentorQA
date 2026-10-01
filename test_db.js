const { PrismaClient } = require('@mentorqa/db');
const prisma = new PrismaClient();

async function check() {
  const job = await prisma.job.findUnique({
    where: { id: 'cmujxdfgq0004mp01wjx5pvl4' },
    include: {
      repository: {
        select: { name: true, detectedStack: true }
      },
      review: true
    }
  });
  console.log('review:', job.review ? 'exists' : 'null');
  if (job.review) console.log('findings isArray:', Array.isArray(job.review.findings));
}
check().then(() => process.exit(0));
