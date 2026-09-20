import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { refreshZoneCache } from '../../services/ingest/pipeline.js';

export const zonesRouter = Router();
zonesRouter.use(requireAuth);

const pointSchema = z.object({ x: z.number(), y: z.number() });

const zoneBodySchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(50),
  level: z.enum(['restricted', 'warning', 'safe']),
  polygon: z.array(pointSchema).min(3, '围栏至少需要 3 个顶点'),
  floor: z.number().default(0),
  speakerGroup: z.string().max(100).optional().nullable(),
  broadcastTpl: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  remark: z.string().max(500).optional().nullable(),
});

zonesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await prisma.zone.findMany({
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { anchors: true } } },
    });
    res.json({ items });
  }),
);

zonesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const zone = await prisma.zone.findUnique({
      where: { id: req.params.id },
      include: { anchors: { select: { id: true, code: true, name: true } } },
    });
    if (!zone) throw AppError.notFound('区域不存在');
    res.json(zone);
  }),
);

zonesRouter.post(
  '/',
  requireRole('admin'),
  validate(zoneBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof zoneBodySchema>;
    const zone = await prisma.zone.create({
      data: {
        code: body.code,
        name: body.name,
        level: body.level,
        polygon: body.polygon as unknown as Prisma.InputJsonValue,
        floor: body.floor,
        speakerGroup: body.speakerGroup ?? null,
        broadcastTpl: body.broadcastTpl ?? null,
        isActive: body.isActive,
        remark: body.remark ?? null,
      },
    });
    await refreshZoneCache(true);
    res.status(201).json(zone);
  }),
);

zonesRouter.patch(
  '/:id',
  requireRole('admin'),
  validate(zoneBodySchema.partial()),
  asyncHandler(async (req, res) => {
    const data = { ...(req.body as Record<string, unknown>) };
    if (data.polygon) {
      data.polygon = data.polygon as unknown as Prisma.InputJsonValue;
    }
    const zone = await prisma.zone.update({
      where: { id: req.params.id },
      data: data as Prisma.ZoneUpdateInput,
    });
    await refreshZoneCache(true);
    res.json(zone);
  }),
);

zonesRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
    if (!zone) throw AppError.notFound('区域不存在');
    const openAlarms = await prisma.alarm.count({
      where: { zoneId: zone.id, status: { in: ['active', 'acked'] } },
    });
    if (openAlarms > 0) {
      throw AppError.conflict('该区域尚有未解除告警，请先处置后再删除');
    }
    await prisma.zone.delete({ where: { id: zone.id } });
    await refreshZoneCache(true);
    res.status(204).end();
  }),
);
