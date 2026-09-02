import 'dotenv/config';
import Redis from 'ioredis';
import { Worker, Job as BullJob } from 'bullmq';
import { PrismaClient, decryptToken } from '@mentorqa/db';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const prisma = new PrismaClient();

async function detectStack(repoPath: string): Promise<{ languages: string[], frameworks: string[] }> {
  const stack = { languages: [] as string[], frameworks: [] as string[] };
  
  const hasFile = (filename: string) => fs.existsSync(path.join(repoPath, filename));

  if (hasFile('package.json')) {
    stack.languages.push('JavaScript/TypeScript');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['react']) stack.frameworks.push('React');
    if (deps['next']) stack.frameworks.push('Next.js');
    if (deps['express']) stack.frameworks.push('Express');
    if (deps['vue']) stack.frameworks.push('Vue');
  }

  if (hasFile('requirements.txt') || hasFile('pyproject.toml') || hasFile('Pipfile')) {
    stack.languages.push('Python');
    if (hasFile('requirements.txt')) {
      const reqs = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8');
      if (reqs.includes('Django')) stack.frameworks.push('Django');
      if (reqs.includes('Flask')) stack.frameworks.push('Flask');
      if (reqs.includes('fastapi')) stack.frameworks.push('FastAPI');
    }
  }

  if (hasFile('pom.xml') || hasFile('build.gradle')) {
    stack.languages.push('Java');
    if (hasFile('pom.xml')) {
      const pom = fs.readFileSync(path.join(repoPath, 'pom.xml'), 'utf8');
      if (pom.includes('spring-boot')) stack.frameworks.push('Spring Boot');
    }
  }

  return stack;
}

async function processJob(job: BullJob) {
  const { jobId, repositoryId, userId } = job.data;
  console.log(`[Job ${jobId}] Starting processing for repository ${repositoryId}...`);

  let tempDir: string | null = null;
  
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const repo = await prisma.repository.findUnique({ where: { id: repositoryId } });

    if (!user || !user.githubAccessToken) throw new Error('User or GitHub token missing');
    if (!repo) throw new Error('Repository missing');

    await prisma.job.update({ where: { id: jobId }, data: { status: 'cloning' } });
    console.log(`[Job ${jobId}] Status: cloning`);

    const token = decryptToken(user.githubAccessToken);
    
    // Setup isolated temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mentorqa-job-${jobId}-`));
    
    const git = simpleGit();
    const cloneUrl = `https://x-access-token:${token}@github.com/${repo.name}.git`;
    
    await git.clone(cloneUrl, tempDir, ['--depth=1']);
    
    await prisma.job.update({ where: { id: jobId }, data: { status: 'cloned' } });
    console.log(`[Job ${jobId}] Status: cloned`);

    const stack = await detectStack(tempDir);

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { detectedStack: stack },
    });

    await prisma.job.update({ where: { id: jobId }, data: { status: 'stack-detected' } });
    console.log(`[Job ${jobId}] Status: stack-detected`);

    await prisma.job.update({ where: { id: jobId }, data: { status: 'done' } });
    console.log(`[Job ${jobId}] Status: done`);

  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[Job ${jobId}] Failed:`, error.message);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'failed' } });
    throw error;
  } finally {
    // For Phase 1, we are instructed to keep it, but normally we would delete.
    // Spec: "(not committed, cleaned up after use — for now clone but don't delete yet, so we can inspect it while testing)."
    if (tempDir) {
      console.log(`[Job ${jobId}] Temp dir retained at: ${tempDir}`);
    }
  }
}

async function main() {
  console.log('🔄 MentorQA Worker starting...');
  await prisma.$connect();
  console.log('✅ Database connected');

  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker('review-pipeline', processJob, { connection: redis });

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} has completed!`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} has failed with ${err.message}`);
  });

  console.log('✅ Worker ready — listening for jobs on "review-pipeline"');

  const shutdown = async () => {
    console.log('\nShutting down worker...');
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
