import { Prisma, type Alarm } from '@prisma/client';
import {
  AlarmStatus,
  AlarmType,
  TYPE_SEVERITY,
  ZONE_SEVERITY,
  type AlarmSeverity,
  type AlarmType as TAlarmType,
} from '../../config/constants.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { thresholds } from '../tracking/config.js';
import { dispatchBroadcast, renderTemplate } from '../broadcast/index.js';
import { realtimeHub } from '../realtime/index.js';

export interface FireInput {
  type: TAlarmType;
  person: { tagId: string; name: string; team: string | null };
  zone?: {
    id: string;
    name: string;
    level: 'restricted' | 'warning' | 'safe';
    speakerGroup: string | null;
    broadcastTpl: string | null;
  } | null;
  dedupKey: string;
  message: string;
  position?: { x: number; y: number; z: number } | null;
  /** 是否允许自动联动广播，缺省按类型策略 */
  autoBroadcast?: boolean;
}

export interface FireResult {
  alarm: Alarm;
  created: boolean;
  /** 本次触发是否实际下发了广播（新建或抑制窗口外重复触发） */
  broadcasted: boolean;
}

/** 这些告警类型产生时自动喊话；低电量/离线只提示不占广播频道 */
const AUTO_BROADCAST_TYPES: ReadonlySet<TAlarmType> = new Set([
  AlarmType.ZONE_INTRUSION,
  AlarmType.STATIONARY,
  AlarmType.SOS,
]);

/**
 * 触发（或在抑制窗口内累加）一条告警。
 *
 * 并发安全：唯一未决告警由数据库部分唯一索引 alarm_open_dedup_uniq 保证。
 * 两个定位批次同时判出同一人闯入时，只有一个 INSERT 成功，另一个走 P2002
 * 分支转为 repeat_count 累加，不会出现重复告警与重复广播。
 */
export async function fireAlarm(input: FireInput): Promise<FireResult> {
  const severity = pickSeverity(input);
  const now = new Date();
  const position = input.position ?? undefined;

  try {
    const alarm = await prisma.alarm.create({
      data: {
        type: input.type,
        severity,
        status: AlarmStatus.ACTIVE,
        personId: input.person.tagId,
        zoneId: input.zone?.id ?? null,
        dedupKey: input.dedupKey,
        message: input.message,
        position: position ?? Prisma.JsonNull,
        firstFiredAt: now,
        lastFiredAt: now,
      },
    });
    logger.warn({ alarmId: alarm.id, dedupKey: input.dedupKey }, '新告警');
    realtimeHub.broadcast({ type: 'alarm', data: alarm });

    const broadcasted = await maybeBroadcast(input, alarm, true);
    return { alarm, created: true, broadcasted };
  } catch (err) {
    if (isDedupConflict(err)) {
      return accumulateExisting(input);
    }
    throw err;
  }
}

/** Prisma P2002：部分唯一索引冲突时 target 通常是索引名 alarm_open_dedup_uniq */
function isDedupConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('dedupKey') || target.includes('alarm_open_dedup_uniq');
  }
  return typeof target === 'string' && target.includes('alarm_open_dedup_uniq');
}

function pickSeverity(input: FireInput): AlarmSeverity {
  if (input.type === AlarmType.ZONE_INTRUSION && input.zone) {
    return ZONE_SEVERITY[input.zone.level] ?? TYPE_SEVERITY[input.type];
  }
  return TYPE_SEVERITY[input.type];
}

async function accumulateExisting(input: FireInput): Promise<FireResult> {
  const existing = await prisma.alarm.findFirst({
    where: {
      dedupKey: input.dedupKey,
      status: { in: [AlarmStatus.ACTIVE, AlarmStatus.ACKED] },
    },
  });
  if (!existing) {
    // 极端竞态：对端刚解除。重试一次创建。
    return fireAlarm(input);
  }

  const now = new Date();
  const sinceLastMs = now.getTime() - existing.lastFiredAt.getTime();
  const outsideWindow = sinceLastMs >= thresholds.dedupWindowSec * 1000;

  const alarm = await prisma.alarm.update({
    where: { id: existing.id },
    data: {
      repeatCount: { increment: 1 },
      lastFiredAt: now,
      // 已确认后又持续触发，说明问题没处理完，退回待确认并保持升级计时
      ...(existing.status === AlarmStatus.ACKED
        ? { status: AlarmStatus.ACTIVE, ackedAt: null, ackedById: null }
        : {}),
    },
  });
  realtimeHub.broadcast({ type: 'alarm', data: alarm });

  const broadcasted = outsideWindow
    ? await maybeBroadcast(input, alarm, false)
    : false;
  return { alarm, created: false, broadcasted };
}

async function maybeBroadcast(input: FireInput, alarm: Alarm, isNew: boolean): Promise<boolean> {
  const should = input.autoBroadcast ?? AUTO_BROADCAST_TYPES.has(input.type);
  // safe 级别区域闯入不喊话（理论上引擎不会为 safe 区域建告警，双保险）
  if (!should || (input.type === AlarmType.ZONE_INTRUSION && input.zone?.level === 'safe')) {
    return false;
  }

  const fallback =
    input.type === AlarmType.SOS
      ? `紧急求救：${input.person.name}${input.person.team ? `（${input.person.team}）` : ''}发出求救信号，请立即救援。`
      : input.type === AlarmType.STATIONARY
        ? `安全提醒：${input.person.name}${input.person.team ? `（${input.person.team}）` : ''}长时间静止，请附近人员前往查看。`
        : input.message;

  const content = renderTemplate(input.zone?.broadcastTpl, {
    name: input.person.name,
    team: input.person.team ?? '',
    zone: input.zone?.name ?? '',
  }, fallback);

  const { broadcast, delivered } = await dispatchBroadcast({
    alarmId: alarm.id,
    triggerType: 'auto',
    targetGroup: input.zone?.speakerGroup ?? null,
    content,
  });
  realtimeHub.broadcast({ type: 'broadcast', data: broadcast });
  logger.info({ alarmId: alarm.id, delivered, isNew }, '告警联动广播完成');
  return true;
}

/**
 * 条件解除：离开区域/恢复移动/重新上线等场景调用。
 * SOS 不允许自动解除——必须调度员核实后手工关闭。
 */
export async function autoResolve(
  dedupKey: string,
  note: string,
  opts: { allowSos?: boolean } = {},
): Promise<Alarm | null> {
  const existing = await prisma.alarm.findFirst({
    where: { dedupKey, status: { in: [AlarmStatus.ACTIVE, AlarmStatus.ACKED] } },
  });
  if (!existing) return null;
  if (existing.type === AlarmType.SOS && !opts.allowSos) return existing;

  const alarm = await prisma.alarm.update({
    where: { id: existing.id },
    data: { status: AlarmStatus.RESOLVED, resolvedAt: new Date(), resolveNote: note },
  });
  logger.info({ alarmId: alarm.id, dedupKey, note }, '告警自动解除');
  realtimeHub.broadcast({ type: 'alarm', data: alarm });
  return alarm;
}

/**
 * 超时未确认升级：warning → critical，并重新广播一次提醒调度台。
 * 由 worker 周期调用。返回本次升级的告警。
 */
export async function escalateStaleAlarms(now = new Date()): Promise<Alarm[]> {
  const cutoff = new Date(now.getTime() - thresholds.escalateAfterSec * 1000);
  const stale = await prisma.alarm.findMany({
    where: {
      status: AlarmStatus.ACTIVE,
      // 只升级 warning；info（如低电量）仅提示，升级并全矿喊话属于噪音
      severity: 'warning',
      escalatedAt: null,
      lastFiredAt: { lt: cutoff },
    },
  });

  const out: Alarm[] = [];
  for (const a of stale) {
    const updated = await prisma.alarm.update({
      where: { id: a.id },
      data: { severity: 'critical', escalatedAt: now },
    });
    realtimeHub.broadcast({ type: 'alarm', data: updated });

    const person = await prisma.person.findUnique({ where: { tagId: a.personId } });
    if (person) {
      const { broadcast } = await dispatchBroadcast({
        alarmId: a.id,
        triggerType: 'auto',
        targetGroup: null,
        content: `调度注意：${person.name} 的告警超过 ${Math.max(1, Math.round(thresholds.escalateAfterSec / 60))} 分钟仍未确认，已升级为紧急，请立即处置。`,
      });
      realtimeHub.broadcast({ type: 'broadcast', data: broadcast });
    }
    out.push(updated);
  }
  return out;
}
