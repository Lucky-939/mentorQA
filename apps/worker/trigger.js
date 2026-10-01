const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();
const connection = new IORedis('redis://localhost:6379');
const reviewQueue = new Queue('review-pipeline', { connection });

async function trigger() {
  const user = await prisma.user.findFirst();
  const repo = await prisma.repository.findFirst({ where: { name: 'Lucky-939/stateless-api' }});
  
  const job = await prisma.job.create({
    data: {
      repositoryId: repo.id,
      status: 'queued',
    }
  });

  await reviewQueue.add('clone-and-detect', {
    jobId: job.id,
    repositoryId: repo.id,
    userId: user.id,
    role: 'Developer'
  });
  console.log('Triggered job:', job.id);
  
  // Wait for job to finish
  let status = 'queued';
  while(status !== 'done' && status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    const currentJob = await prisma.job.findUnique({ where: { id: job.id } });
    status = currentJob.status;
    console.log('Status:', status);
  }

  const review = await prisma.review.findUnique({ where: { jobId: job.id } });
  const archFindings = review.findings.filter(f => f.category === 'architecture');
  console.log('Arch Findings:', JSON.stringify(archFindings, null, 2));
}

trigger().catch(console.error).finally(() => { prisma.$disconnect(); connection.quit(); });
