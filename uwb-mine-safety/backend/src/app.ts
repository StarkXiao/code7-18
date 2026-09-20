import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes.js';

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.frontendBaseUrl ? env.frontendBaseUrl.split(',') : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(requestId);
  app.use((req, _res, next) => {
    if (req.path !== '/api/v1/healthz') {
      logger.debug({ method: req.method, path: req.path }, 'request');
    }
    next();
  });

  app.use('/api/v1', apiRouter);
  app.use(errorHandler);
  return app;
}
