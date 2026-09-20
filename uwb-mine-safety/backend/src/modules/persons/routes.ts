import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { buildPage, parsePagination } from '../../utils/pagination.js';
import { createPersonSchema, listPersonsSchema, updatePersonSchema } from './schemas.js';

export const personsRouter = Router();

personsRouter.use(requireAuth);

/** 人员列表（分页 + 关键字/班组/状态筛选） */
personsRouter.get(
  '/',
  validate(listPersonsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      keyword?: string;
      team?: string;
      status?: 'active' | 'stationary' | 'offline';
    };
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const where: Prisma.PersonWhereInput = { isDeleted: false };
    if (q.status) where.status = q.status;
    if (q.team) where.team = q.team;
    if (q.keyword) {
      where.OR = [
        { name: { contains: q.keyword, mode: 'insensitive' } },
        { tagId: { contains: q.keyword, mode: 'insensitive' } },
        { employeeNo: { contains: q.keyword, mode: 'insensitive' } },
        { team: { contains: q.keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.person.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      prisma.person.count({ where }),
    ]);
    res.json(buildPage(items, total, pagination));
  }),
);

/** 大屏用：全部人员精简快照（不分页） */
personsRouter.get(
  '/snapshot',
  asyncHandler(async (_req, res) => {
    const items = await prisma.person.findMany({
      where: { isDeleted: false },
      select: {
        tagId: true,
        name: true,
        team: true,
        jobTitle: true,
        status: true,
        batteryPct: true,
        lastPos: true,
        lastSeenAt: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ items });
  }),
);

/** 班组去重列表（筛选用） */
personsRouter.get(
  '/teams',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.person.findMany({
      where: { isDeleted: false, team: { not: null } },
      distinct: ['team'],
      select: { team: true },
      orderBy: { team: 'asc' },
    });
    res.json({ items: rows.map((r) => r.team) });
  }),
);

personsRouter.get(
  '/:tagId',
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findFirst({
      where: { tagId: req.params.tagId, isDeleted: false },
    });
    if (!person) throw AppError.notFound('人员不存在');

    const recentAlarms = await prisma.alarm.findMany({
      where: { personId: person.tagId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { zone: { select: { name: true } } },
    });
    res.json({ person, recentAlarms });
  }),
);

/** 最近轨迹（默认最近 30 分钟，最多 2000 点） */
personsRouter.get(
  '/:tagId/track',
  asyncHandler(async (req, res) => {
    const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes ?? 30)));
    const since = new Date(Date.now() - minutes * 60_000);
    const positions = await prisma.position.findMany({
      where: { personId: req.params.tagId, measuredAt: { gte: since } },
      orderBy: { measuredAt: 'asc' },
      take: 2000,
      select: { x: true, y: true, z: true, measuredAt: true },
    });
    res.json({ items: positions });
  }),
);

personsRouter.post(
  '/',
  requireRole('admin'),
  validate(createPersonSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as Prisma.PersonCreateInput;
    const exists = await prisma.person.findUnique({ where: { tagId: body.tagId } });
    if (exists) throw AppError.conflict(`标签号 ${body.tagId} 已登记`);
    const person = await prisma.person.create({ data: body });
    res.status(201).json(person);
  }),
);

personsRouter.patch(
  '/:tagId',
  requireRole('admin'),
  validate(updatePersonSchema),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findFirst({
      where: { tagId: req.params.tagId, isDeleted: false },
    });
    if (!person) throw AppError.notFound('人员不存在');
    const updated = await prisma.person.update({
      where: { tagId: person.tagId },
      data: req.body as Prisma.PersonUpdateInput,
    });
    res.json(updated);
  }),
);

/** 软删除：保留历史位置与告警的可追溯性 */
personsRouter.delete(
  '/:tagId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await prisma.person.updateMany({
      where: { tagId: req.params.tagId, isDeleted: false },
      data: { isDeleted: true },
    });
    if (result.count === 0) throw AppError.notFound('人员不存在');
    res.status(204).end();
  }),
);
