import 'dotenv/config';
import { PrismaClient, decryptToken } from '@mentorqa/db';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const prisma = new PrismaClient();

async function detectStack(repoPath: string): Promise<{ languages: string[], frameworks: string[] }> {
  const stack = { languages: [] as string[], frameworks: [] as string[] };
  const hasFile = (filename: string) => fs.existsSync(path.join(repoPath, filename));

  if (hasFile('package.json')) {
    stack.languages.push('JavaScript/TypeScript');
  }
  if (hasFile('requirements.txt') || hasFile('pyproject.toml') || hasFile('Pipfile')) {
    stack.languages.push('Python');
  }
  if (hasFile('pom.xml') || hasFile('build.gradle')) {
    stack.languages.push('Java');
  }
  return stack;
}

async function processJob(job: any) {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mentorqa-job-${jobId}-`));
    
    const git = simpleGit();
    const cloneUrl = `https://x-access-token:${token}@github.com/${repo.name}.git`;
    
    await git.clone(cloneUrl, tempDir, ['--depth=1']);
    
    await prisma.job.update({ where: { id: jobId }, data: { status: 'cloned' } });
    console.log(`[Job ${jobId}] Status: cloned`);

    const stack = await detectStack(tempDir);
    await prisma.repository.update({ where: { id: repositoryId }, data: { detectedStack: stack } });

    await prisma.job.update({ where: { id: jobId }, data: { status: 'stack-detected' } });
    console.log(`[Job ${jobId}] Status: stack-detected`);

    await prisma.job.update({ where: { id: jobId }, data: { status: 'analyzing-static' } });
    console.log(`[Job ${jobId}] Status: analyzing-static`);

    let staticFindings = [];
    let analysisSuccess = false;
    
    try {
      const response = await fetch('http://127.0.0.1:8000/analyze/static', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: tempDir, detectedStack: stack })
      });
      if (!response.ok) throw new Error(`Analysis service HTTP ${response.status}`);
      const data = (await response.json()) as any;
      staticFindings = data.findings || [];
      analysisSuccess = true;
    } catch (analysisErr) {
      console.error(`[Job ${jobId}] Analysis service down or error:`, analysisErr);
    }

    await prisma.review.upsert({
      where: { jobId },
      update: { staticAnalysis: staticFindings },
      create: { jobId, staticAnalysis: staticFindings }
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
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[Job ${jobId}] Temp dir cleaned up: ${tempDir}`);
    }
  }
}

async function run(repoName: string) {
  const repo = await prisma.repository.findFirst({ where: { name: repoName } });
  if (!repo) throw new Error("Repo not found: " + repoName);
  const job = await prisma.job.findFirst({ where: { repositoryId: repo.id }, orderBy: { createdAt: 'desc' } });
  if (!job) throw new Error("Job not found for " + repoName);

  const bullJob = { data: { jobId: job.id, repositoryId: repo.id, userId: repo.ownerId } };
  try {
    await processJob(bullJob);
    console.log("processJob finished successfully for " + repoName);
    const review = await prisma.review.findUnique({ where: { jobId: job.id } });
    console.log(`[${repoName}] Review findings count:`, review?.staticAnalysis ? (review.staticAnalysis as any[]).length : 0);
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
