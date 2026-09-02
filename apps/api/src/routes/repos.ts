import { Router, Response } from 'express';
import { Octokit } from 'octokit';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../lib/prisma';
import { decryptToken } from '@mentorqa/db';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const reposRouter: Router = Router();

// Setup BullMQ Queue
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
export const reviewQueue = new Queue('review-pipeline', { connection });

// ── GET /repos ────────────────────────────────────────────────────────────────
// Lists the authenticated user's GitHub repositories.

reposRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.githubAccessToken) {
      res.status(400).json({ error: 'GitHub access token not found for user' });
      return;
    }

    const token = decryptToken(user.githubAccessToken);
    const octokit = new Octokit({ auth: token });

    const response = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 30,
      sort: 'updated',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repos = response.data.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
    }));

    res.json({ data: repos });
  } catch (error) {
    console.error('Error fetching repos:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// ── POST /repos/select ────────────────────────────────────────────────────────
// Select a repo, persist it, and enqueue a job.

reposRouter.post('/select', requireAuth, async (req: AuthRequest, res: Response) => {
  const { repoFullName, role } = req.body;

  if (!repoFullName) {
    res.status(400).json({ error: 'repoFullName is required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.githubAccessToken) {
      res.status(400).json({ error: 'GitHub access token not found for user' });
      return;
    }

    const token = decryptToken(user.githubAccessToken);
    const octokit = new Octokit({ auth: token });

    const [owner, repo] = repoFullName.split('/');
    
    // Verify we can access it and get default branch
    const repoResponse = await octokit.rest.repos.get({ owner, repo });
    const githubRepo = repoResponse.data;

    // Upsert repository in DB
    const repository = await prisma.repository.upsert({
      where: { githubRepoId: String(githubRepo.id) },
      update: {
        name: githubRepo.full_name,
        defaultBranch: githubRepo.default_branch,
      },
      create: {
        githubRepoId: String(githubRepo.id),
        ownerId: user.id,
        name: githubRepo.full_name,
        defaultBranch: githubRepo.default_branch,
      },
    });

    // Create Job in DB
    const job = await prisma.job.create({
      data: {
        repositoryId: repository.id,
        status: 'queued',
      },
    });

    // Enqueue job to BullMQ
    await reviewQueue.add('clone-and-detect', {
      jobId: job.id,
      repositoryId: repository.id,
      userId: user.id,
      role: role || null,
    });

    res.json({ data: { jobId: job.id, repositoryId: repository.id } });
  } catch (error) {
    console.error('Error selecting repo:', error);
    res.status(500).json({ error: 'Failed to select repository' });
  }
});
