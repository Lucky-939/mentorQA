import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string | null;
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing token' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');

    const payload = jwt.verify(token, secret) as {
      sub: string;
      username: string;
      email: string | null;
    };

    req.user = {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Unauthorized: token expired' });
    } else {
      res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
  }
}
