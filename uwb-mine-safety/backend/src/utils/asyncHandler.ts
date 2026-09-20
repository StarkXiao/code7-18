import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

/** 把抛错的异步处理器包装成 Express 兼容签名 */
export function asyncHandler<
  TParams = ParamsDictionary,
  TRes = unknown,
  TBody = unknown,
  TQuery = Record<string, unknown>,
>(
  fn: (
    req: Request<TParams, TRes, TBody, TQuery>,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return (
    req: Request<TParams, TRes, TBody, TQuery>,
    res: Response,
    next: NextFunction,
  ): void => {
    fn(req, res, next).catch(next);
  };
}
