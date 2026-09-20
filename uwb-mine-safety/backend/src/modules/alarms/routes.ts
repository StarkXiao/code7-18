import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { buildPage, parsePagination } from '../../utils/pagination.js';
import { realtimeHub } from '../../services/realtime/index.js';
import { autoResolve } from '../../services/alarm/fire.js';

export const alarmsRouter = Router();
alarmsRouter.use(requireAuth);

const listQuerySchema = z.object({
  status: z.enum(['active', 'acked', 'resolved']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  type: z.enum(['zone_intrusion', 'stationary', 'sos', 'low_battery', 'offline']).optional(),
  tagId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

alarmsRouter.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof listQuerySchema>;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const where: Prisma.AlarmWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (q.type) where.type = q.type;
    if (q.tagId) where.personId = q.tagId;

    const [items, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { severity: 'desc' },
          { lastFiredAt: 'desc' },
        ],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        include: {
          person: { select: { tagId: true, name: true, team: true } },
          zone: { select: { id: true, name: true, level: true } },
          ackedBy: { select: { displayName: true } },
        },
      }),
      prisma.alarm.count({ where }),
    ]);

    const itemsWithAckName = items.map(({ ackedBy, ...rest }) => ({
      ...rest,
      ackedByName: ackedBy?.displayName ?? null,
    }));
    res.json(buildPage(itemsWithAckName, total, pagination));
  }),
);

/** 未决告警数量（大屏角标） */
alarmsRouter.get(
  '/open-count',
  asyncHandler(async (_req, res) => {
    const [active, acked] = await Promise.all([
      prisma.alarm.count({ where: { status: 'active' } }),
      prisma.alarm.count({ where: { status: 'acked' } }),
    ]);
    const critical = await prisma.alarm.count({
      where: { status: { in: ['active', 'acked'] }, severity: 'critical' },
    });
    res.json({ active, acked, open: active + acked, critical });
  }),
);

alarmsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const alarm = await prisma.alarm.findUnique({
      where: { id: req.params.id },
      include: {
        person: { select: { tagId: true, name: true, team: true, phone: true, jobTitle: true } },
        zone: true,
        broadcasts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!alarm) throw AppError.notFound('告警不存在');
    res.json(alarm);
  }),
);

/** 确认告警：表示调度已知悉并开始处置 */
alarmsRouter.post(
  '/:id/ack',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const alarm = await prisma.alarm.findUnique({ where: { id: req.params.id } });
    if (!alarm) throw AppError.notFound('告警不存在');
    if (alarm.status === 'resolved') throw AppError.conflict('告警已解除，无需确认');

    const updated = await prisma.alarm.update({
      where: { id: alarm.id },
      data: {
        status: 'acked',
        ackedAt: new Date(),
        ackedById: req.user!.sub,
      },
      include: { person: { select: { name: true } } },
    });
    realtimeHub.broadcast({ type: 'alarm', data: updated });
    res.json(updated);
  }),
);

const resolveSchema = z.object({
  note: z.string().max(500).optional().default('调度员确认现场安全，手动解除'),
});

/** 解除告警：现场核实完毕 */
alarmsRouter.post(
  '/:id/resolve',
  requireRole('admin', 'dispatcher'),
  validate(resolveSchema),
  asyncHandler(async (req, res) => {
    const { note } = req.body as z.infer<typeof resolveSchema>;
    const alarm = await prisma.alarm.findUnique({ where: { id: req.params.id } });
    if (!alarm) throw AppError.notFound('告警不存在');
    if (alarm.status === 'resolved') throw AppError.conflict('告警已解除');

    const updated = await prisma.alarm.update({
      where: { id: alarm.id },
      data: { status: 'resolved', resolvedAt: new Date(), resolveNote: note },
      include: { person: { select: { name: true } } },
    });
    realtimeHub.broadcast({ type: 'alarm', data: updated });
    res.json(updated);
  }),
);

/** 按 dedupKey 手工解除（SOS 也走这里，必须人工核实） */
alarmsRouter.post(
  '/resolve-key',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const dedupKey = String(req.body?.dedupKey ?? '');
    if (!dedupKey) throw AppError.badRequest('dedupKey 必填');
    const alarm = await autoResolve(dedupKey, '调度员手工解除', { allowSos: true });
    if (!alarm) throw AppError.notFound('没有匹配的未解除告警');
    res.json(alarm);
  }),
);
