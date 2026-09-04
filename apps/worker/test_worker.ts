import 'dotenv/config';
import { PrismaClient } from '@mentorqa/db';
import { processJob } from './src/index';

const prisma = new PrismaClient();

async function run() {
  await prisma.$connect();
  const repo = await prisma.repository.findFirst({ where: { name: 'Lucky-939/mentorQA' } });
  if (!repo) throw new Error("Repo not found");
  const job = await prisma.job.findFirst({ where: { repositoryId: repo.id, status: 'queued' } });
  if (!job) throw new Error("Job not found");

  const bullJob = {
    data: {
      jobId: job.id,
      repositoryId: repo.id,
      userId: repo.ownerId
    }
  } as any;

  try {
    await processJob(bullJob);
    console.log("processJob finished successfully.");
    const review = await prisma.review.findUnique({ where: { jobId: job.id } });
    console.log("Review findings count:", review?.staticAnalysis?.length);
    console.log(JSON.stringify(review?.staticAnalysis, null, 2));
  } catch (err) {
    console.error("processJob failed", err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

run();
