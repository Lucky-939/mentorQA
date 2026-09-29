import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import neo4j from 'neo4j-driver';

let neo4jDriver: any = null;
function getNeo4jDriver() {
  if (!neo4jDriver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'mentorqa_neo4j';
    neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return neo4jDriver;
}

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
        },
        review: true
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

jobsRouter.get('/:id/graph', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const drv = getNeo4jDriver();
    const session = drv.session();
    
    try {
      const nodesRes = await session.run(
        `MATCH (n:Node {repositoryId: $repositoryId}) RETURN properties(n) AS node`,
        { repositoryId: job.repositoryId }
      );
      
      const edgesRes = await session.run(
        `MATCH (s:Node {repositoryId: $repositoryId})-[r]->(t:Node {repositoryId: $repositoryId}) 
         RETURN s.id AS source, t.id AS target, type(r) AS relationship`,
        { repositoryId: job.repositoryId }
      );

      const nodes = nodesRes.records.map((r: any) => r.get('node'));
      const edges = edgesRes.records.map((r: any) => ({
        source: r.get('source'),
        target: r.get('target'),
        relationship: r.get('relationship')
      }));

      res.json({ data: { nodes, edges } });
    } finally {
      await session.close();
    }
  } catch (error) {
    console.error('Error fetching graph:', error);
    res.status(500).json({ error: 'Failed to fetch graph' });
  }
});
