import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { buildPage, parsePagination } from '../../utils/pagination.js';
import { dispatchBroadcast } from '../../services/broadcast/index.js';
import { realtimeHub } from '../../services/realtime/index.js';

export const broadcastsRouter = Router();
broadcastsRouter.use(requireAuth);

const createSchema = z.object({
  content: z.string().min(1, '播报内容必填').max(500),
  targetGroup: z.string().max(100).optional().nullable(),
});

broadcastsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const [items, total] = await Promise.all([
      prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        include: {
          alarm: { select: { id: true, type: true } },
          createdBy: { select: { displayName: true } },
        },
      }),
      prisma.broadcast.count(),
    ]);
    res.json(buildPage(items, total, pagination));
  }),
);

/** 调度员手动全矿/分区广播 */
broadcastsRouter.post(
  '/',
  requireRole('admin', 'dispatcher'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const { broadcast } = await dispatchBroadcast({
      alarmId: null,
      triggerType: 'manual',
      targetGroup: body.targetGroup ?? null,
      content: body.content,
      createdById: req.user!.sub,
    });
    realtimeHub.broadcast({ type: 'broadcast', data: broadcast });
    res.status(201).json(broadcast);
  }),
);

/** 失败重发 */
broadcastsRouter.post(
  '/:id/retry',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const record = await prisma.broadcast.findUnique({ where: { id: req.params.id } });
    if (!record) throw AppError.notFound('广播记录不存在');
    if (record.status === 'sent') throw AppError.conflict('该广播已成功下发');

    const { broadcast } = await dispatchBroadcast({
      alarmId: record.alarmId,
      triggerType: record.triggerType as 'auto' | 'manual',
      targetGroup: record.targetGroup,
      content: record.content,
      createdById: record.createdById,
    });
    realtimeHub.broadcast({ type: 'broadcast', data: broadcast });
    res.json(broadcast);
  }),
);
