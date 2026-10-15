/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@mentorqa/db';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const prisma = new PrismaClient();
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const reviewQueue = new Queue('review-pipeline', { connection });

async function trigger(repoFullName: string, githubRepoId: string) {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error('No user found');

  const repository = await prisma.repository.upsert({
    where: { githubRepoId },
    update: {
      name: repoFullName,
      defaultBranch: 'main'
    },
    create: {
      githubRepoId,
      ownerId: user.id,
      name: repoFullName,
      defaultBranch: 'main'
    }
  });

  const job = await prisma.job.create({
    data: {
      repositoryId: repository.id,
      status: 'queued'
    }
  });

  console.log(`[Trigger] Created Job ${job.id} for ${repoFullName}`);
  await reviewQueue.add('clone-and-detect', {
    jobId: job.id,
    repositoryId: repository.id,
    userId: user.id,
    role: null
  });

  console.log(`[Trigger] Enqueued job ${job.id}. Waiting for completion...`);
  const t0 = Date.now();

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const currentJob = await prisma.job.findUnique({
      where: { id: job.id },
      include: { review: true }
    });

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[Wait +${elapsed}s] Job ${job.id} status: ${currentJob?.status}`);

    if (currentJob?.status === 'done' || currentJob?.status === 'completed' || currentJob?.status === 'failed' || currentJob?.status === 'static analysis failed') {
      console.log(`\n======================================================`);
      console.log(`JOB ${job.id} FINISHED with status: ${currentJob.status}`);
      console.log(`Total duration: ${Math.round((Date.now() - t0) / 1000)}s`);
      console.log(`======================================================\n`);

      if (currentJob.review) {
        const review = currentJob.review;
        const findings = (review.findings as any[]) || [];
        console.log(`Review ID: ${review.id}`);
        console.log(`Total Findings: ${findings.length}`);

        // Status counts
        const statusCounts: Record<string, number> = {};
        for (const f of findings) {
          const st = f.metadata?.mentorStatus || 'none';
          statusCounts[st] = (statusCounts[st] || 0) + 1;
        }
        console.log('\n--- MENTOR STATUS COUNTS ---');
        console.table(statusCounts);

        // Enrichment Stats
        const stats = (review as any).enrichmentStats;
        console.log('\n--- ENRICHMENT STATS ---');
        console.log(JSON.stringify(stats, null, 2));

        // Sample complete mentor objects
        const enriched = findings.filter((f) => f.metadata?.mentor);
        console.log(`\n--- SAMPLE COMPLETE MENTOR OBJECTS (${Math.min(3, enriched.length)} shown) ---`);
        enriched.slice(0, 3).forEach((f, idx) => {
          console.log(`\n[Mentor Object ${idx + 1}] Finding ID: ${f.id} | Rule: ${f.ruleId} | Category: ${f.category} | File: ${f.file}`);
          console.log(JSON.stringify(f.metadata.mentor, null, 2));
        });
      }
      break;
    }

    if (elapsed > 400) {
      console.error('[Trigger] Timed out waiting for job after 400s');
      break;
    }
  }

  await connection.quit();
  await prisma.$disconnect();
}

const targetRepo = process.argv[2] || 'Lucky-939/mentorqa-vulnerable-fixtures';
const targetId = process.argv[3] || '1419865566';

trigger(targetRepo, targetId).catch((err) => {
  console.error('[Trigger Error]', err);
  process.exit(1);
});
