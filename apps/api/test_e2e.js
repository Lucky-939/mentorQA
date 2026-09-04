const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const connection = new IORedis('redis://localhost:6379');
const reviewQueue = new Queue('review-pipeline', { connection });

async function trigger(repoFullName) {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found");
  
  const repository = await prisma.repository.upsert({
    where: { githubRepoId: repoFullName },
    update: { name: repoFullName, defaultBranch: 'master' },
    create: {
      githubRepoId: repoFullName,
      ownerId: user.id,
      name: repoFullName,
      defaultBranch: 'master',
    },
  });

  const job = await prisma.job.create({
    data: { repositoryId: repository.id, status: 'queued' },
  });

  await reviewQueue.add('clone-and-detect', {
    jobId: job.id,
    repositoryId: repository.id,
    userId: user.id,
  });
  
  console.log(`Triggered job ${job.id} for ${repoFullName}`);
}

async function main() {
  await trigger('Lucky-939/mentorQA'); // JS/TS + Python
  await trigger('junit-team/junit4'); // Java
  process.exit(0);
}
main().catch(console.error);
