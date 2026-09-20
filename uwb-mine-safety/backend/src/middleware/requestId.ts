import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') as string) || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
