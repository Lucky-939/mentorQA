import 'dotenv/config';
import { PrismaClient } from '@mentorqa/db';
import { processJob } from './src/index';

const prisma = new PrismaClient();

async function run() {
  await prisma.$connect();
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found");

  let repo = await prisma.repository.findFirst({ where: { name: 'Lucky-939/stateless-api' } });
  if (!repo) {
    repo = await prisma.repository.create({
      data: {
        name: 'Lucky-939/stateless-api',
        ownerId: user.id,
        githubRepoId: 'test-stateless'
      }
    });
  }
  let job = await prisma.job.create({
      data: {
        repositoryId: repo.id,
        status: 'queued',
      }
  });

  const bullJob = {
    data: {
      jobId: job.id,
      repositoryId: repo.id,
      userId: user.id
    }
  } as any;

  try {
    await processJob(bullJob);
    console.log("processJob finished successfully.");
    const review = await prisma.review.findUnique({ where: { jobId: job.id } });
    console.log("Review findings count:", review?.findings?.length);
    console.log(JSON.stringify(review?.findings, null, 2));
  } catch (err) {
    console.error("processJob failed", err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

run();
