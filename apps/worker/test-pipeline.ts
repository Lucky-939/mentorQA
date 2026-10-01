import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient, encryptToken } from '@mentorqa/db';
import dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();
const connection = new IORedis('redis://localhost:6380');
const reviewQueue = new Queue('review-pipeline', { connection });

async function run() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        githubId: '123',
        username: 'test',
        email: 'test@example.com',
        githubAccessToken: encryptToken('mock-token')
      }
    });
  }

  const repository = await prisma.repository.upsert({
    where: { githubRepoId: '9999999' },
    update: { name: 'Lucky-939/stateless-api', defaultBranch: 'main' },
    create: { githubRepoId: '9999999', ownerId: user.id, name: 'Lucky-939/stateless-api', defaultBranch: 'main' },
  });

  const job = await prisma.job.create({
    data: { repositoryId: repository.id, status: 'queued' },
  });

  const start = Date.now();
  console.log(`[TEST] Starting job ${job.id} at ${new Date(start).toISOString()}`);
  
  await reviewQueue.add('clone-and-detect', {
    jobId: job.id,
    repositoryId: repository.id,
    userId: user.id,
    role: null,
  });

  let lastStatus = '';
  while (true) {
    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    if (updatedJob?.status !== lastStatus) {
      console.log(`[TEST] Status changed to: ${updatedJob?.status}`);
      lastStatus = updatedJob?.status || '';
    }
    if (updatedJob?.status === 'done' || updatedJob?.status === 'failed') {
      const end = Date.now();
      console.log(`[TEST] Job finished with status: ${updatedJob.status}`);
      console.log(`[TEST] Total wall-clock time: ${(end - start) / 1000} seconds`);
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
