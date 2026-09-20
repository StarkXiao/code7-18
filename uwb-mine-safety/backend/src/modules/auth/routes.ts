import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/errors.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, signAccessToken, type AuthPayload } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { loginSchema } from './schemas.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'login' }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await prisma.user.findUnique({ where: { username } });
    // 用户名不存在也走一次 bcrypt 比较，抹平响应时间差，避免枚举账号
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok || !user.isActive) {
      throw AppError.unauthorized('用户名或密码错误');
    }

    const payload: AuthPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    };
    res.json({
      accessToken: signAccessToken(payload),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);
