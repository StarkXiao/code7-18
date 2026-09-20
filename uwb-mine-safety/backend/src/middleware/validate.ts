import type { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

type Part = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(result.error);
      return;
    }
    // query 是只读 getter 集合，部分场景下需要可写；仅在 body/params 时回写
    if (part !== 'query') {
      req[part] = result.data as typeof req[typeof part];
    } else {
      Object.assign(req.query, result.data);
    }
    next();
  };
}
