import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const anchorsRouter = Router();
anchorsRouter.use(requireAuth);

anchorsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await prisma.anchor.findMany({
      orderBy: { code: 'asc' },
      include: { zone: { select: { id: true, name: true } } },
    });
    res.json({ items });
  }),
);

anchorsRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = req.body as Prisma.AnchorUncheckedCreateInput;
    if (!body.code || !body.name || [body.x, body.y].some((n) => typeof n !== 'number')) {
      throw AppError.badRequest('code/name/x/y 必填');
    }
    const anchor = await prisma.anchor.create({ data: body });
    res.status(201).json(anchor);
  }),
);

anchorsRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const anchor = await prisma.anchor.update({
      where: { id: req.params.id },
      data: req.body as Prisma.AnchorUpdateInput,
    });
    res.json(anchor);
  }),
);

anchorsRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await prisma.anchor.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
