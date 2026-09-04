import 'dotenv/config';
import Redis from 'ioredis';
import { Worker, Job as BullJob } from 'bullmq';
import { PrismaClient, decryptToken, Prisma } from '@mentorqa/db';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateTestWithGemini, KeyFunction } from './testGenerator';
import { setupSandbox, executeTest } from './sandbox';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const prisma = new PrismaClient();
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

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

export async function processJob(job: BullJob) {
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
    
    await git.clone(cloneUrl, tempDir, ['--depth=1', '--branch=feature/phase-1']);
    
    await prisma.job.update({ where: { id: jobId }, data: { status: 'cloned' } });
    console.log(`[Job ${jobId}] Status: cloned`);

    const stack = await detectStack(tempDir);

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { detectedStack: stack },
    });

    await prisma.job.update({ where: { id: jobId }, data: { status: 'stack-detected' } });
    console.log(`[Job ${jobId}] Status: stack-detected`);

    // Phase 2: Static Analysis
    await prisma.job.update({ where: { id: jobId }, data: { status: 'analyzing-static' } });
    console.log(`[Job ${jobId}] Status: analyzing-static`);

    let staticFindings: Prisma.InputJsonValue[] = [];
    let keyFunctions: KeyFunction[] = [];
    let analysisSuccess = false;
    
    try {
      const response = await fetch('http://127.0.0.1:8000/analyze/static', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: tempDir, detectedStack: stack })
      });
      if (!response.ok) {
        throw new Error(`Analysis service HTTP ${response.status}`);
      }
      const data = await response.json() as { findings?: Prisma.InputJsonValue[], keyFunctions?: KeyFunction[] };
      staticFindings = data.findings || [];
      keyFunctions = data.keyFunctions || [];
      analysisSuccess = true;
    } catch (analysisErr) {
      console.error(`[Job ${jobId}] Analysis service down or error:`, analysisErr);
    }

    // Phase 3: AI Test Generation
    await prisma.job.update({ where: { id: jobId }, data: { status: 'generating-tests' } });
    console.log(`[Job ${jobId}] Status: generating-tests`);

    const testFindings: Prisma.InputJsonValue[] = [];
    const maxFunctions = parseInt(process.env.GEMINI_MAX_FUNCTIONS_PER_RUN || '15', 10);
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      console.log(`[Job ${jobId}] GEMINI_API_KEY missing. Skipping test generation.`);
      testFindings.push({
        id: crypto.randomUUID(),
        category: "test-coverage",
        severity: "low",
        file: "Project",
        lineStart: 0,
        lineEnd: 0,
        message: "No test coverage (skipped due to missing AI config).",
        ruleId: "skipped-tests-no-key"
      });
    } else {
      const targetFunctions = keyFunctions.slice(0, maxFunctions);
      
      let aiAvailable = true;
      let setupDone = false;

      for (const func of targetFunctions) {
        if (!aiAvailable) {
          testFindings.push({
            id: crypto.randomUUID(),
            category: "test-coverage",
            severity: "low",
            file: func.file,
            lineStart: 0,
            lineEnd: 0,
            message: "No test coverage (skipped due to rate limit/AI unavailable).",
            ruleId: "skipped-tests-ai-down"
          });
          continue;
        }

        try {
          const testCode = await generateTestWithGemini(func, redis, geminiApiKey);
          if (testCode) {
            // Setup sandbox once if we have tests to run
            if (!setupDone) {
              try {
                await setupSandbox(tempDir, stack);
              } catch (setupErr) {
                console.warn(`[Job ${jobId}] Sandbox setup failed:`, setupErr);
              }
              setupDone = true;
            }

            const result = await executeTest(tempDir, func, testCode);
            testFindings.push({
              id: crypto.randomUUID(),
              category: "test-coverage",
              severity: result.passed ? "info" : "medium",
              file: func.file,
              lineStart: 0,
              lineEnd: 0,
              message: result.message,
              ruleId: result.passed ? "generated-test-passed" : "generated-test-failed"
            });
          }
        } catch (err: unknown) {
          const error = err as Error;
          console.error(`[Job ${jobId}] Gemini/Sandbox error for ${func.name}:`, error.message);
          if (error.message.includes('429') || error.message.includes('API Error')) {
            aiAvailable = false;
            testFindings.push({
              id: crypto.randomUUID(),
              category: "test-coverage",
              severity: "low",
              file: func.file,
              lineStart: 0,
              lineEnd: 0,
              message: "No test coverage (skipped due to AI unavailability or 429).",
              ruleId: "skipped-tests-ai-down"
            });
          } else {
             testFindings.push({
              id: crypto.randomUUID(),
              category: "test-coverage",
              severity: "low",
              file: func.file,
              lineStart: 0,
              lineEnd: 0,
              message: `No test coverage (error during generation: ${error.message}).`,
              ruleId: "skipped-tests-error"
            });
          }
        }
      }
    }

    const allFindings = [...staticFindings, ...testFindings];

    // Save findings to Review model
    await prisma.review.upsert({
      where: { jobId },
      update: { findings: allFindings },
      create: { jobId, findings: allFindings }
    });

    if (analysisSuccess) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done' } });
      console.log(`[Job ${jobId}] Status: done`);
    } else {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'static analysis failed' } });
      console.log(`[Job ${jobId}] Status: static analysis failed`);
    }

  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[Job ${jobId}] Failed:`, error.message);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'failed' } });
    throw error;
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[Job ${jobId}] Temp dir cleaned up: ${tempDir}`);
      } catch (rmErr) {
        console.error(`[Job ${jobId}] Failed to clean temp dir:`, rmErr);
      }
    }
  }
}

async function main() {
  console.log('🔄 MentorQA Worker starting...');
  await prisma.$connect();
  console.log('✅ Database connected');

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
