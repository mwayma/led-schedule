import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

// Generate a random session secret on startup if not specified in environment
export const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');
export const COOKIE_NAME = 'led_schedule_token';

export interface AuthenticatedRequest extends Request {
  user?: {
    role: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { role: string };
    req.user = decoded;
    next();
  } catch (error) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}
