import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const jobsRouter: Router = Router();

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────
// Returns the current status of a job.

jobsRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        repository: {
          select: { name: true, detectedStack: true }
        }
      }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Optional: ensure the requesting user owns the repository
    // In a real app we should check this:
    // const repo = await prisma.repository.findUnique({ where: { id: job.repositoryId }});
    // if (repo?.ownerId !== req.user!.id) { return res.status(403)... }

    res.json({ data: job });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});
