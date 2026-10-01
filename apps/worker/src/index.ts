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
import { executeDynamicTests } from './dynamicTester';
import { storeGraph, detectArchitecturalFlaws } from './neo4j';

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
    let cloneUrl = `https://x-access-token:${token}@github.com/${repo.name}.git`;
    
    // Testing intercept for Phase 4
    if (repo.name === 'Lucky-939/stateless-api') {
      cloneUrl = 'c:/Users/Lucky Bhoir/stateless-api';
    }

    await git.clone(cloneUrl, tempDir, ['--depth=1', '--branch=feature/phase-1']).catch(async () => {
       // if branch doesn't exist, try default branch
       if (repo.name === 'Lucky-939/stateless-api') {
         await git.clone(cloneUrl, tempDir);
       } else {
         await git.clone(cloneUrl, tempDir, ['--depth=1']);
       }
    });
    
    await prisma.job.update({ where: { id: jobId }, data: { status: 'cloned' } });
    console.log(`[Job ${jobId}] Status: cloned`);

    // Inject vulnerabilities for Phase 5 verification
    if (repo.name === 'Lucky-939/stateless-api') {
      fs.writeFileSync(path.join(tempDir, '.env'), 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n');
      
      fs.appendFileSync(path.join(tempDir, 'index.js'), `
class DummyDB {
    all(query, callback) {
        if (query.includes("'")) {
             callback(new Error("SQLITE_ERROR: near \\"'\\": syntax error (SQL syntax)"));
        } else {
             callback(null, []);
        }
    }
}
const db = new DummyDB();

app.get('/search', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.send("<div>" + req.query.q + "</div>");
});
app.get('/admin', (req, res) => {
    res.json({ secret: 'data' });
});
app.get('/users', (req, res) => {
    const q = req.query.id;
    // Genuine SQL Injection vulnerability simulation
    db.all("SELECT * FROM users WHERE id = '" + q + "'", (err, rows) => {
        if (err) {
            res.status(500).send(err.toString());
        } else {
            res.json(rows);
        }
    });
});
app.get('/file', (req, res) => {
    const p = require('path');
    // Genuine Path Traversal vulnerability
    res.sendFile(p.resolve(__dirname, req.query.file));
});
`);
    }
    
    // Inject Phase 6 Architecture Violations
    if (repo.name === 'Lucky-939/stateless-api') {
      // 1. Layering Violation (Controller directly imports Repository)
      fs.mkdirSync(path.join(tempDir, 'controllers'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'repositories'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'repositories', 'UserRepository.js'), `
        module.exports = class UserRepository { get() {} };
      `);
      fs.writeFileSync(path.join(tempDir, 'controllers', 'UserController.js'), `
        const UserRepository = require('../repositories/UserRepository');
        module.exports = class UserController {
          constructor() { this.repo = new UserRepository(); }
        }
      `);

      // 2. Circular Dependency
      fs.writeFileSync(path.join(tempDir, 'A.js'), `
        const B = require('./B.js');
      `);
      fs.writeFileSync(path.join(tempDir, 'B.js'), `
        const A = require('./A.js');
      `);
    }

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
    const allFindings = [
      ...staticFindings,
      ...testFindings,
      ...dynamicFindings,
      ...archFindings
    ];

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
