import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@mentorqa/db';

const prisma = new PrismaClient();
const connection = new IORedis('redis://127.0.0.1:6380');
const reviewQueue = new Queue('review-pipeline', { connection });

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found in DB");

  const repoFullName = 'Lucky-939/stateless-api';
  
  // Create dummy repository if not exist
  let repository = await prisma.repository.findFirst({ where: { name: repoFullName } });
  if (!repository) {
    repository = await prisma.repository.create({
      data: {
        githubRepoId: "123456",
        ownerId: user.id,
        name: repoFullName,
        defaultBranch: "main",
      }
    });
  }

  const job = await prisma.job.create({
    data: {
      repositoryId: repository.id,
      status: 'queued',
    }
  });

  await reviewQueue.add('clone-and-detect', {
    jobId: job.id,
    repositoryId: repository.id,
    userId: user.id,
    role: 'Developer',
  });

  console.log(`Job ${job.id} enqueued for ${repoFullName}`);
  
  // Wait for it to finish
  setInterval(async () => {
    const check = await prisma.job.findUnique({ where: { id: job.id } });
    if (check?.status === 'done' || check?.status === 'failed') {
      console.log(`Job finished with status: ${check.status}`);
      process.exit(0);
    }
  }, 2000);
}

main().catch(console.error);
