import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { reposRouter } from './routes/repos';
import { jobsRouter } from './routes/jobs';

import { Express } from "express";
const app: Express = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true, // allow cookies on cross-origin requests
  })
);
app.use(express.json());
app.use(cookieParser());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/repos', reposRouter);
app.use('/jobs', jobsRouter);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
