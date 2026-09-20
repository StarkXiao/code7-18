import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { ingestPositions } from '../../services/ingest/pipeline.js';

export const positionsRouter = Router();

const ingestItemSchema = z.object({
  tagId: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
  z: z.number().default(0),
  batteryPct: z.number().int().min(0).max(100).optional().nullable(),
  measuredAt: z.union([z.number(), z.string()]).optional().nullable(),
  sos: z.boolean().optional().nullable(),
});

const ingestSchema = z.object({
  // 单条上报也兼容批量：UWB 定位引擎通常 1Hz 批量推送
  positions: z.array(ingestItemSchema).min(1).max(500),
});

/**
 * 设备鉴权：X-Ingest-Key。与用户 JWT 完全隔离——
 * 网关被攻破后拿不到后台账号，且可以单独吊销。
 */
async function requireIngestKey(headerValue: string | undefined): Promise<void> {
  const key = headerValue?.trim();
  if (!key) throw AppError.unauthorized('缺少 X-Ingest-Key');

  const record = await prisma.ingestKey.findUnique({ where: { key } });
  if (!record || !record.isActive) throw AppError.unauthorized('接入凭证无效或已停用');

  // 异步记录最近使用时间，不阻塞入库
  void prisma.ingestKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

positionsRouter.post(
  '/ingest',
  rateLimit({ windowMs: 1000, max: 20, keyPrefix: 'ingest' }),
  validate(ingestSchema),
  asyncHandler(async (req, res) => {
    await requireIngestKey(req.header('x-ingest-key'));
    const { positions } = req.body as z.infer<typeof ingestSchema>;
    const result = await ingestPositions(positions);
    // 有部分未登记标签也返回 207 风格的 200，网关可据 rejected 排查；全部非法才 4xx 已在 body 校验拦截
    res.status(200).json({ ok: true, ...result });
  }),
);

/** 接入凭证管理（admin） */
positionsRouter.get(
  '/keys',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.ingestKey.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ items });
  }),
);

positionsRouter.post(
  '/keys',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? 'UWB 网关');
    const key = `uwb_${crypto.randomBytes(24).toString('hex')}`;
    const record = await prisma.ingestKey.create({ data: { name, key } });
    res.status(201).json(record);
  }),
);

positionsRouter.post(
  '/keys/:id/revoke',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await prisma.ingestKey.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.status(204).end();
  }),
);
