import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (isAppError(err)) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: req.requestId,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_error',
        message: '请求参数校验失败',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId: req.requestId,
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({
        error: { code: 'not_found', message: '资源不存在' },
        requestId: req.requestId,
      });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'conflict', message: '唯一约束冲突，记录可能已存在' },
        requestId: req.requestId,
      });
      return;
    }
  }

  logger.error({ err, requestId: req.requestId, path: req.path }, '未处理异常');
  res.status(500).json({
    error: { code: 'internal_error', message: '服务器内部错误' },
    requestId: req.requestId,
  });
};
