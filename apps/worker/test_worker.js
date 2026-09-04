require('dotenv/config');
const { PrismaClient } = require('@mentorqa/db');
const { processJob } = require('./dist/index.js');

const prisma = new PrismaClient();

async function run(repoName) {
  const repo = await prisma.repository.findFirst({ where: { name: repoName } });
  if (!repo) throw new Error("Repo not found: " + repoName);
  const job = await prisma.job.findFirst({ where: { repositoryId: repo.id }, orderBy: { createdAt: 'desc' } });
  if (!job) throw new Error("Job not found for " + repoName);

  const bullJob = {
    data: {
      jobId: job.id,
      repositoryId: repo.id,
      userId: repo.ownerId
    }
  };

  try {
    await processJob(bullJob);
    console.log("processJob finished successfully for " + repoName);
    const review = await prisma.review.findUnique({ where: { jobId: job.id } });
    console.log(`[${repoName}] Review findings count:`, review?.staticAnalysis?.length);
  } catch (err) {
    console.error(`processJob failed for ${repoName}`, err);
  }
}

async function main() {
  await prisma.$connect();
  await run('Lucky-939/mentorQA'); // JS/TS + Python
  await run('junit-team/junit4'); // Java
  await prisma.$disconnect();
}

main().catch(console.error);
