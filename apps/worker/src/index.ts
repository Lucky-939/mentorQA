/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-require-imports */
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
import { executeDynamicTests, Endpoint } from './dynamicTester';
import { storeGraph, detectArchitecturalFlaws } from './neo4j';
import { enrichFindings, verifyGeminiModel } from './mentor';
import { Finding } from '@mentorqa/shared-types';

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

  if (hasFile('requirements.txt') || hasFile('pyproject.toml') || hasFile('Pipfile') || hasFile('services/analysis/requirements.txt')) {
    stack.languages.push('Python');
    if (hasFile('requirements.txt')) {
      const reqs = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8');
      if (reqs.includes('Django')) stack.frameworks.push('Django');
      if (reqs.includes('Flask')) stack.frameworks.push('Flask');
      if (reqs.includes('fastapi')) stack.frameworks.push('FastAPI');
    } else if (hasFile('services/analysis/requirements.txt')) {
      const reqs = fs.readFileSync(path.join(repoPath, 'services/analysis/requirements.txt'), 'utf8');
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

    let token = '';
    try {
      token = decryptToken(user.githubAccessToken);
    } catch (e) {
      console.warn(`[Job ${jobId}] Failed to decrypt GitHub token. Continuing with empty token.`);
    }
    
    // Setup isolated temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mentorqa-job-${jobId}-`));
    
    const git = simpleGit();
    const cloneUrl = token ? `https://x-access-token:${token}@github.com/${repo.name}.git` : `https://github.com/${repo.name}.git`;
    
    await git.clone(cloneUrl, tempDir, ['--depth=1', '--branch=feature/phase-1']).catch(async () => {
      // if branch doesn't exist, try default branch
      await git.clone(cloneUrl, tempDir as string, ['--depth=1']);
    });
    
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
    let endpoints: Endpoint[] = [];
    let nodes: any[] = [];
    let edges: any[] = [];
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
      const data = await response.json() as { findings?: Prisma.InputJsonValue[], keyFunctions?: KeyFunction[], endpoints?: Endpoint[], nodes?: any[], edges?: any[] };
      staticFindings = data.findings || [];
      keyFunctions = data.keyFunctions || [];
      endpoints = data.endpoints || [];
      nodes = data.nodes || [];
      edges = data.edges || [];
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
      const targetFunctions = keyFunctions.filter(f => ['python', 'javascript', 'typescript'].includes(f.language.toLowerCase())).slice(0, maxFunctions);
      
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
          console.log(`[Job ${jobId}][${new Date().toISOString()}] [generating-tests:gemini-test-gen] Generating unit test for ${func.name} (${func.file})...`);
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

            console.log(`[Job ${jobId}][${new Date().toISOString()}] [generating-tests:test-run] Executing sandboxed test for ${func.name}...`);
            const result = await executeTest(tempDir, func, testCode);
            console.log(`[Job ${jobId}][${new Date().toISOString()}] [generating-tests:test-run] Finished test for ${func.name} (passed: ${result.passed}).`);
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

    // Phase 4 & 5: Dynamic Testing (API, Security, Performance)
    let dynamicFindings: Prisma.InputJsonValue[] = [];
    if (tempDir) {
      try {
        dynamicFindings = await executeDynamicTests(tempDir, stack, endpoints, jobId, async (status) => {
          await prisma.job.update({ where: { id: jobId }, data: { status } });
          console.log(`[Job ${jobId}] Status: ${status}`);
        });
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`[Job ${jobId}] Dynamic testing error:`, error.message);
        dynamicFindings.push({
           id: crypto.randomUUID(),
           category: "system",
           severity: "medium",
           file: "Project",
           lineStart: 0,
           lineEnd: 0,
           message: `Dynamic testing encountered a fatal error: ${error.message}`,
           ruleId: "dynamic-testing-fatal"
        });
      }
    }

    // Phase 6: Graph Building & Architecture Analysis
    await prisma.job.update({ where: { id: jobId }, data: { status: 'building-graph' } });
    console.log(`[Job ${jobId}] Status: building-graph`);
    
    let archFindings: Prisma.InputJsonValue[] = [];
    try {
        if (nodes.length > 0) {
            await storeGraph(repositoryId, nodes, edges);
            archFindings = await detectArchitecturalFlaws(repositoryId);
        }
    } catch (err) {
        console.error(`[Job ${jobId}] Failed to store graph in Neo4j:`, err);
    }
    
    // Save findings
    let allFindings: any[] = [
      ...staticFindings,
      ...testFindings,
      ...dynamicFindings,
      ...archFindings
    ];

    // Phase 7: AI Mentor Enrichment
    let enrichmentStats: any = null;
    const stageController = new AbortController();
    const enrichmentBudgetMs = 90000; // 90s hard overall stage budget
    const budgetTimer = setTimeout(() => {
      stageController.abort();
    }, enrichmentBudgetMs);

    try {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'enriching-findings' } });
      console.log(`[Job ${jobId}] Status: enriching-findings`);

      const apiKey = process.env.GEMINI_API_KEY;
      const result = await enrichFindings(
        allFindings as unknown as Finding[],
        tempDir,
        redis,
        apiKey,
        undefined,
        undefined,
        undefined,
        undefined,
        stageController.signal
      );
      clearTimeout(budgetTimer);

      allFindings = result.enrichedFindings;
      enrichmentStats = result.stats;
      if (!stageController.signal.aborted) {
        console.log(`[Job ${jobId}] Enrichment completed:`, {
          eligible: enrichmentStats.eligible,
          findingsEnriched: enrichmentStats.findingsEnriched,
          cached: enrichmentStats.cached,
          apiCalls: enrichmentStats.apiCalls,
          skippedCap: enrichmentStats.skippedCap,
          skippedQuota: enrichmentStats.skippedQuota,
          durationMs: enrichmentStats.durationMs
        });
      } else {
        console.warn(`[Job ${jobId}] Enrichment stage budget expired (90s); saving completed findings.`);
      }
    } catch (enrichErr: any) {
      clearTimeout(budgetTimer);
      console.error(`[Job ${jobId}] Enrichment stage error (proceeding with raw findings):`, enrichErr.message);
    }

    // Save findings to Review model
    const serializedFindings = JSON.parse(JSON.stringify(allFindings));
    const serializedStats = enrichmentStats ? JSON.parse(JSON.stringify(enrichmentStats)) : undefined;
    await prisma.review.upsert({
      where: { jobId },
      update: { findings: serializedFindings, enrichmentStats: serializedStats },
      create: { jobId, findings: serializedFindings, enrichmentStats: serializedStats }
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
  const undiciPkg = require('undici/package.json');
  console.log(`[MentorQA Startup] Imported undici version: ${undiciPkg.version}, process.versions.undici: ${(process.versions as any).undici || 'none (Node runtime)'}`);
  await prisma.$connect();
  console.log('✅ Database connected');

  const apiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  if (apiKey) {
    verifyGeminiModel(apiKey, geminiModel).catch((err) =>
      console.warn('[MentorQA] Advisory model check error:', err.message)
    );
  }

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
