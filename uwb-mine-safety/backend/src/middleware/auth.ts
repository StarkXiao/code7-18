import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import type { Role } from '@prisma/client';

export interface AuthPayload {
  sub: string;
  username: string;
  role: Role;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessTtlSec });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw AppError.unauthorized('缺少访问令牌');

  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthPayload;
    next();
  } catch {
    throw AppError.unauthorized('访问令牌无效或已过期');
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw AppError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden(`需要 ${roles.join(' 或 ')} 权限`);
    }
    next();
  };
}
