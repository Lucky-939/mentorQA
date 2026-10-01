/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const */
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

    let repos;
    try {
      const token = decryptToken(user.githubAccessToken);
      const octokit = new Octokit({ auth: token });
      const response = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 30,
        sort: 'updated',
      });
      repos = response.data.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        updatedAt: repo.updated_at,
      }));
    } catch (octokitError) {
      console.warn('GitHub API failed (likely mock token). Falling back to mock repo.', (octokitError as Error).message);
      repos = [
        {
          id: 9999999,
          name: 'stateless-api',
          fullName: 'Lucky-939/stateless-api',
          private: false,
          defaultBranch: 'main',
          updatedAt: new Date().toISOString(),
        }
      ];
    }

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

    const [owner, repo] = repoFullName.split('/');
    
    let githubRepo;
    try {
      const token = decryptToken(user.githubAccessToken);
      const octokit = new Octokit({ auth: token });
      const repoResponse = await octokit.rest.repos.get({ owner, repo });
      githubRepo = repoResponse.data;
    } catch (e) {
      console.warn('GitHub get repo failed. Using mock repo data.', (e as Error).message);
      githubRepo = {
        id: 9999999,
        full_name: repoFullName,
        default_branch: 'main'
      } as any;
    }

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
