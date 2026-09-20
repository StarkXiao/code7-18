import { Router } from 'express';
import { authRouter } from './modules/auth/routes.js';
import { personsRouter } from './modules/persons/routes.js';
import { anchorsRouter } from './modules/anchors/routes.js';
import { zonesRouter } from './modules/zones/routes.js';
import { positionsRouter } from './modules/positions/routes.js';
import { alarmsRouter } from './modules/alarms/routes.js';
import { broadcastsRouter } from './modules/broadcasts/routes.js';
import { statsRouter } from './modules/stats/routes.js';

export const apiRouter = Router();

apiRouter.get('/healthz', (_req, res) => res.json({ ok: true }));

apiRouter.use('/auth', authRouter);
apiRouter.use('/persons', personsRouter);
apiRouter.use('/anchors', anchorsRouter);
apiRouter.use('/zones', zonesRouter);
apiRouter.use('/positions', positionsRouter);
apiRouter.use('/alarms', alarmsRouter);
apiRouter.use('/broadcasts', broadcastsRouter);
apiRouter.use('/stats', statsRouter);
