import { Router, Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { encryptToken } from '@mentorqa/db';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const authRouter: Router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateAccessToken(payload: { sub: string; username: string; email: string | null }) {
  const secret = process.env.JWT_ACCESS_SECRET!;
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    { sub: payload.sub, username: payload.username, email: payload.email },
    secret,
    { expiresIn }
  );
}

function generateRefreshToken(userId: string) {
  const secret = process.env.JWT_REFRESH_SECRET!;
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign({ sub: userId }, secret, { expiresIn });
}

function setRefreshCookie(res: Response, token: string) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 'strict' blocks cross-origin cookie on POST; lax works for localhost dev
    maxAge: sevenDays,
    path: '/', // allow Next.js middleware to see it on /dashboard
  });
}

// ── GET /auth/login ───────────────────────────────────────────────────────────
// Redirects browser to GitHub OAuth authorisation page.

authRouter.get('/login', (_req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'GitHub OAuth not configured' });
    return;
  }

  // Generate a random state parameter to prevent CSRF during OAuth flow
  const state = crypto.randomBytes(16).toString('hex');

  // In production, store `state` in a short-lived session or signed cookie.
  // For Phase 0 we store it as a plain cookie (validated in /auth/callback).
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.GITHUB_CALLBACK_URL!,
    scope: 'read:user user:email public_repo',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// ── GET /auth/callback ────────────────────────────────────────────────────────
// GitHub redirects here after the user authorises.

authRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  // Validate state to prevent CSRF
  const storedState = req.cookies?.oauth_state;
  if (!state || state !== storedState) {
    res.status(400).json({ error: 'Invalid OAuth state parameter' });
    return;
  }
  res.clearCookie('oauth_state');

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    // 1. Exchange code for GitHub access token
    const tokenResponse = await axios.post<{
      access_token: string;
      token_type: string;
      scope: string;
    }>(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
      },
      { headers: { Accept: 'application/json' } }
    );

    const githubAccessToken = tokenResponse.data.access_token;
    if (!githubAccessToken) {
      throw new Error('No access token returned from GitHub');
    }

    // 2. Fetch authenticated user info from GitHub
    const [userResponse, emailsResponse] = await Promise.all([
      axios.get<{ id: number; login: string; email: string | null }>(
        'https://api.github.com/user',
        { headers: { Authorization: `Bearer ${githubAccessToken}` } }
      ),
      axios.get<Array<{ email: string; primary: boolean; verified: boolean }>>(
        'https://api.github.com/user/emails',
        { headers: { Authorization: `Bearer ${githubAccessToken}` } }
      ),
    ]);

    const githubUser = userResponse.data;
    const primaryEmail =
      emailsResponse.data.find((e) => e.primary && e.verified)?.email ||
      githubUser.email;

    const encryptedToken = encryptToken(githubAccessToken);

    // 3. Upsert user in database
    const user = await prisma.user.upsert({
      where: { githubId: String(githubUser.id) },
      update: {
        username: githubUser.login,
        email: primaryEmail,
        githubAccessToken: encryptedToken,
      },
      create: {
        githubId: String(githubUser.id),
        username: githubUser.login,
        email: primaryEmail,
        githubAccessToken: encryptedToken,
      },
    });

    // 4. Issue tokens
    const accessToken = generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
    });
    const refreshToken = generateRefreshToken(user.id);

    setRefreshCookie(res, refreshToken);

    // 5. Redirect to web app with access token in query string (one-time, short-lived)
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    res.redirect(`${webUrl}/auth/callback?token=${accessToken}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    res.redirect(`${webUrl}/?error=auth_failed`);
  }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
// Returns the currently authenticated user's profile.

authRouter.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ data: req.user });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
// Issues a new access token using the refresh token cookie.

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  try {
    const secret = process.env.JWT_REFRESH_SECRET!;
    const payload = jwt.verify(refreshToken, secret) as { sub: string };

    // Fetch current user to get up-to-date info for the new access token
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const newAccessToken = generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
    });

    // Rotate refresh token (issue a new one)
    const newRefreshToken = generateRefreshToken(user.id);
    setRefreshCookie(res, newRefreshToken);

    res.json({ data: { accessToken: newAccessToken } });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Refresh token expired, please log in again' });
    } else {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

authRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ message: 'Logged out successfully' });
});
