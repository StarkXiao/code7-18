import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { AlarmStatus, PersonStatus } from '../../config/constants.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

/** 调度大屏汇总数据 */
statsRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [total, active, stationary, offline, openAlarms, criticalAlarms, onlineAnchors, totalAnchors, todayResolved] =
      await Promise.all([
        prisma.person.count({ where: { isDeleted: false } }),
        prisma.person.count({ where: { isDeleted: false, status: PersonStatus.ACTIVE } }),
        prisma.person.count({ where: { isDeleted: false, status: PersonStatus.STATIONARY } }),
        prisma.person.count({ where: { isDeleted: false, status: PersonStatus.OFFLINE } }),
        prisma.alarm.count({ where: { status: { in: [AlarmStatus.ACTIVE, AlarmStatus.ACKED] } } }),
        prisma.alarm.count({
          where: { status: AlarmStatus.ACTIVE, severity: 'critical' },
        }),
        prisma.anchor.count({ where: { isOnline: true } }),
        prisma.anchor.count(),
        prisma.alarm.count({
          where: { status: AlarmStatus.RESOLVED, resolvedAt: { gte: startOfToday() } },
        }),
      ]);

    // 最近 24 小时各类型告警计数
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const byTypeRaw = await prisma.alarm.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const alarmsByType: Record<string, number> = {};
    for (const row of byTypeRaw) alarmsByType[row.type] = row._count._all;

    // 各班组下井人数
    const byTeamRaw = await prisma.person.groupBy({
      by: ['team'],
      where: { isDeleted: false, status: { not: PersonStatus.OFFLINE } },
      _count: { _all: true },
    });
    const personsByTeam = byTeamRaw.map((r) => ({
      team: r.team ?? '未分班',
      count: r._count._all,
    }));

    res.json({
      persons: { total, active, stationary, offline },
      alarms: { open: openAlarms, criticalActive: criticalAlarms, todayResolved, byType: alarmsByType },
      anchors: { total: totalAnchors, online: onlineAnchors },
      personsByTeam,
      generatedAt: new Date(),
    });
  }),
);

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
