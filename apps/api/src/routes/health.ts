import { Router, Request, Response } from 'express';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'mentorqa-api',
    timestamp: new Date().toISOString(),
  });
});
