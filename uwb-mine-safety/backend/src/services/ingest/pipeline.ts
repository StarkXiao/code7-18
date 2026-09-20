import type { Person, Zone } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { thresholds } from '../tracking/config.js';
import { AlarmType, PersonStatus, ZoneLevel } from '../../config/constants.js';
import { pointInPolygon, type Point } from '../geo/index.js';
import { TrackWindow, evaluateStationary, type TrackSample } from '../tracking/stationary.js';
import { autoResolve, fireAlarm } from '../alarm/fire.js';
import { realtimeHub } from '../realtime/index.js';

export interface IngestItem {
  tagId: string;
  x: number;
  y: number;
  z: number;
  batteryPct?: number | null;
  /** 标签测量时间（epoch ms / ISO），缺省取入库时刻 */
  measuredAt?: number | string | null;
  /** 标签 SOS 按钮 */
  sos?: boolean | null;
}

export interface IngestResult {
  accepted: number;
  rejected: { tagId: string; reason: string }[];
  alarmsFired: number;
}

/**
 * 进程内规则状态。重启后最坏一个扫描周期内重新收敛，不影响安全语义：
 * - 围栏：重新判定，未决告警由 DB 唯一索引兜底
 * - 静止：最坏 afterSec 秒后重新检出
 */
const trackWindow = new TrackWindow();
/** 人员当前所在的告警区域 dedupKey 集合 */
const insideZones = new Map<string, Set<string>>();
/** 低电量告警是否已在响（带迟滞恢复） */
const lowBatteryActive = new Set<string>();

export function _resetRuleStateForTest(): void {
  for (const id of trackWindow.personIds()) trackWindow.clear(id);
  insideZones.clear();
  lowBatteryActive.clear();
}

/** 区域缓存：围栏配置变更频率极低，进程内缓存 30 秒，避免每条定位都查库 */
let zoneCache: Zone[] = [];
let zoneCacheFetchedAt = 0;
const ZONE_CACHE_TTL_MS = 30_000;

export async function refreshZoneCache(force = false): Promise<Zone[]> {
  const now = Date.now();
  if (force || now - zoneCacheFetchedAt > ZONE_CACHE_TTL_MS) {
    zoneCache = await prisma.zone.findMany({ where: { isActive: true } });
    zoneCacheFetchedAt = now;
  }
  return zoneCache;
}

/**
 * 处理一批定位数据。整批在一个事务里落位置与人员快照，规则判定在事务外
 * （告警写入失败不能回滚定位数据——位置是事后追责的证据，必须先保住）。
 */
export async function ingestPositions(items: IngestItem[]): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, rejected: [], alarmsFired: 0 };
  if (items.length === 0) return result;
  if (items.length > env.ingestMaxBatch) {
    result.rejected.push({ tagId: '*', reason: `批量超过上限 ${env.ingestMaxBatch}` });
    return result;
  }

  const valid: { item: IngestItem; measuredAt: Date }[] = [];
  const tagIds = new Set<string>();
  for (const item of items) {
    if (!item.tagId || typeof item.tagId !== 'string') {
      result.rejected.push({ tagId: String(item.tagId ?? ''), reason: 'tagId 缺失' });
      continue;
    }
    if (![item.x, item.y, item.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      result.rejected.push({ tagId: item.tagId, reason: '坐标非法' });
      continue;
    }
    const measuredAt = parseTime(item.measuredAt);
    if (measuredAt.getTime() > Date.now() + 5000) {
      result.rejected.push({ tagId: item.tagId, reason: '测量时间在未来，疑似时钟未同步' });
      continue;
    }
    valid.push({ item, measuredAt });
    tagIds.add(item.tagId);
  }
  if (valid.length === 0) return result;

  const persons = await prisma.person.findMany({
    where: { tagId: { in: [...tagIds] }, isDeleted: false },
  });
  const personMap = new Map(persons.map((p) => [p.tagId, p]));

  // 落库
  const rows = valid
    .filter(({ item }) => personMap.has(item.tagId))
    .map(({ item, measuredAt }) => ({
      personId: item.tagId,
      tagId: item.tagId,
      x: item.x,
      y: item.y,
      z: item.z,
      batteryPct: item.batteryPct ?? null,
      measuredAt,
    }));

  const unknownTags = valid.filter(({ item }) => !personMap.has(item.tagId));
  for (const { item } of unknownTags) {
    result.rejected.push({ tagId: item.tagId, reason: '标签未登记或人员已停用' });
  }
  if (rows.length === 0) return result;

  await prisma.position.createMany({ data: rows });

  const zones = await refreshZoneCache();
  const now = Date.now();
  const liveUpdates: unknown[] = [];

  for (const { item, measuredAt } of valid) {
    const person = personMap.get(item.tagId);
    if (!person) continue;
    result.accepted++;

    // 之前离线 → 恢复
    if (person.status === PersonStatus.OFFLINE) {
      await autoResolve(dedupOffline(person.tagId), '标签重新上报，恢复在线');
    }

    await updatePersonSnapshot(person, item, measuredAt);
    liveUpdates.push({
      tagId: person.tagId,
      name: person.name,
      team: person.team,
      x: item.x,
      y: item.y,
      z: item.z,
      batteryPct: item.batteryPct ?? person.batteryPct,
      t: measuredAt.getTime(),
      sos: Boolean(item.sos),
    });

    // 规则判定
    const fired = await runRules(person, item, measuredAt, zones, now);
    result.alarmsFired += fired;
  }

  if (liveUpdates.length > 0) {
    realtimeHub.broadcast({ type: 'positions', data: liveUpdates });
  }
  return result;
}

async function updatePersonSnapshot(
  person: Person,
  item: IngestItem,
  measuredAt: Date,
): Promise<void> {
  await prisma.person.update({
    where: { tagId: person.tagId },
    data: {
      lastPos: { x: item.x, y: item.y, z: item.z },
      lastSeenAt: measuredAt,
      batteryPct: item.batteryPct ?? person.batteryPct,
      // 静止状态由规则引擎最终裁决；有新点先视为 active，
      // 若静止规则命中，runRules 内再改回 stationary。
      status: PersonStatus.ACTIVE,
    },
  });
}

/**
 * 对单个人的最新点跑全部规则，返回本次实际新建告警数。
 */
async function runRules(
  person: Person,
  item: IngestItem,
  measuredAt: Date,
  zones: Zone[],
  now: number,
): Promise<number> {
  let fired = 0;

  // ---- 1. 电子围栏 ----
  fired += await applyZoneRules(person, item, zones);

  // ---- 2. 长时间静止 ----
  fired += await applyStationaryRule(person, item, measuredAt, now);

  // ---- 3. SOS ----
  if (item.sos) {
    const r = await fireAlarm({
      type: AlarmType.SOS,
      person: personRef(person),
      dedupKey: dedupSos(person.tagId),
      message: `${person.name} 按下标签 SOS 求救按钮`,
      position: { x: item.x, y: item.y, z: item.z },
    });
    if (r.created) fired++;
  }

  // ---- 4. 低电量（带 5% 迟滞，防止电量在阈值附近抖动反复告警） ----
  fired += await applyLowBatteryRule(person, item);

  return fired;
}

async function applyZoneRules(person: Person, item: IngestItem, zones: Zone[]): Promise<number> {
  let fired = 0;
  const current = new Set<string>();

  for (const zone of zones) {
    // 跨水平不判定（人在 -520m 水平，不应该触发 -480m 水平的围栏）
    if (Math.abs(zone.floor - item.z) > 5) continue;
    const polygon = zone.polygon as unknown as Point[];
    if (!Array.isArray(polygon) || polygon.length < 3) continue;
    if (zone.level === ZoneLevel.SAFE) continue;
    if (!pointInPolygon({ x: item.x, y: item.y }, polygon)) continue;

    const key = dedupZone(person.tagId, zone.id);
    current.add(key);
    const r = await fireAlarm({
      type: AlarmType.ZONE_INTRUSION,
      person: personRef(person),
      zone: {
        id: zone.id,
        name: zone.name,
        level: zone.level,
        speakerGroup: zone.speakerGroup,
        broadcastTpl: zone.broadcastTpl,
      },
      dedupKey: key,
      message: `${person.name}${person.team ? `（${person.team}）` : ''}进入${zone.level === ZoneLevel.RESTRICTED ? '禁止进入' : '警告'}区域「${zone.name}」`,
      position: { x: item.x, y: item.y, z: item.z },
    });
    if (r.created) fired++;
  }

  // 离开判定：上一轮在、这一轮不在 → 自动解除
  const prev = insideZones.get(person.tagId) ?? new Set<string>();
  for (const key of prev) {
    if (!current.has(key)) {
      await autoResolve(key, '人员已离开危险区域');
    }
  }
  insideZones.set(person.tagId, current);
  return fired;
}

async function applyStationaryRule(
  person: Person,
  item: IngestItem,
  measuredAt: Date,
  now: number,
): Promise<number> {
  const sample: TrackSample = { x: item.x, y: item.y, z: item.z, t: measuredAt.getTime() };
  trackWindow.add(person.tagId, sample, thresholds.stationaryAfterSec);

  const verdict = evaluateStationary(
    trackWindow.get(person.tagId),
    now,
    thresholds.stationaryRadiusM,
    thresholds.stationaryAfterSec,
  );
  const key = dedupStationary(person.tagId);

  if (verdict.stationary && verdict.center) {
    await prisma.person.update({
      where: { tagId: person.tagId },
      data: { status: PersonStatus.STATIONARY },
    });
    realtimeHub.broadcast({
      type: 'person',
      data: { tagId: person.tagId, status: PersonStatus.STATIONARY },
    });
    const durationSec = verdict.clusterStart
      ? Math.round((now - verdict.clusterStart) / 1000)
      : thresholds.stationaryAfterSec;
    const r = await fireAlarm({
      type: AlarmType.STATIONARY,
      person: personRef(person),
      dedupKey: key,
      message: `${person.name} 在 (${verdict.center.x.toFixed(1)}, ${verdict.center.y.toFixed(1)}) 附近静止已超过 ${Math.round(durationSec / 60)} 分钟`,
      position: verdict.center,
    });
    return r.created ? 1 : 0;
  }

  // 恢复移动 → 解除静止告警（若之前在响）
  if (person.status === PersonStatus.STATIONARY) {
    await autoResolve(key, '人员恢复移动');
  }
  return 0;
}

async function applyLowBatteryRule(person: Person, item: IngestItem): Promise<number> {
  const battery = item.batteryPct;
  if (battery === null || battery === undefined) return 0;

  if (battery <= thresholds.lowBatteryPercent && !lowBatteryActive.has(person.tagId)) {
    lowBatteryActive.add(person.tagId);
    const r = await fireAlarm({
      type: AlarmType.LOW_BATTERY,
      person: personRef(person),
      dedupKey: dedupLowBattery(person.tagId),
      message: `${person.name} 的定位标签电量仅剩 ${battery}%，请及时更换`,
      position: { x: item.x, y: item.y, z: item.z },
      autoBroadcast: false,
    });
    return r.created ? 1 : 0;
  }
  if (battery >= thresholds.lowBatteryPercent + 5 && lowBatteryActive.has(person.tagId)) {
    lowBatteryActive.delete(person.tagId);
    await autoResolve(dedupLowBattery(person.tagId), `电量恢复至 ${battery}%`);
  }
  return 0;
}

/** 离线扫描（worker 周期调用）：超时未上报 → 离线告警 */
export async function detectOffline(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - thresholds.offlineAfterSec * 1000);
  const stale = await prisma.person.findMany({
    where: {
      isDeleted: false,
      status: { not: PersonStatus.OFFLINE },
      lastSeenAt: { lt: cutoff },
    },
  });

  let count = 0;
  for (const person of stale) {
    await prisma.person.update({
      where: { tagId: person.tagId },
      data: { status: PersonStatus.OFFLINE },
    });
    realtimeHub.broadcast({
      type: 'person',
      data: { tagId: person.tagId, status: PersonStatus.OFFLINE },
    });
    const r = await fireAlarm({
      type: AlarmType.OFFLINE,
      person: personRef(person),
      dedupKey: dedupOffline(person.tagId),
      message: `${person.name} 的定位标签超过 ${Math.max(1, Math.round(thresholds.offlineAfterSec / 60))} 分钟无信号`,
      position: (person.lastPos as { x: number; y: number; z: number } | null) ?? undefined,
      autoBroadcast: false,
    });
    if (r.created) count++;
  }
  if (count > 0) logger.warn({ count }, '检出离线标签');
  return count;
}

/**
 * 围栏对账（worker 周期调用）。
 * 进程重启后 insideZones 内存丢失，若有人当时在区域内随后离开，解除会漏判。
 * 这里以数据库中所有未解除的区域告警为准，用人员最新位置复核。
 */
export async function reconcileZoneAlarms(): Promise<number> {
  const zones = await refreshZoneCache(true);
  const open = await prisma.alarm.findMany({
    where: { type: AlarmType.ZONE_INTRUSION, status: { in: ['active', 'acked'] } },
    include: { zone: true },
  });

  let resolved = 0;
  for (const alarm of open) {
    if (!alarm.zoneId || !alarm.zone) continue;
    const person = await prisma.person.findUnique({ where: { tagId: alarm.personId } });
    if (!person || !person.lastPos) continue;
    const pos = person.lastPos as { x: number; y: number; z: number };
    const zone = zones.find((z) => z.id === alarm.zoneId);
    if (!zone || !zone.isActive) continue;

    const stillInside =
      Math.abs(zone.floor - pos.z) <= 5 &&
      pointInPolygon({ x: pos.x, y: pos.y }, zone.polygon as unknown as Point[]);
    if (!stillInside) {
      await autoResolve(alarm.dedupKey, '定时复核：人员已不在区域内');
      resolved++;
    }
  }
  return resolved;
}

function personRef(person: Person) {
  return { tagId: person.tagId, name: person.name, team: person.team };
}

function parseTime(v: number | string | null | undefined): Date {
  if (v === null || v === undefined) return new Date();
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export const dedupZone = (tagId: string, zoneId: string) => `${AlarmType.ZONE_INTRUSION}:${tagId}:${zoneId}`;
export const dedupStationary = (tagId: string) => `${AlarmType.STATIONARY}:${tagId}`;
export const dedupSos = (tagId: string) => `${AlarmType.SOS}:${tagId}`;
export const dedupLowBattery = (tagId: string) => `${AlarmType.LOW_BATTERY}:${tagId}`;
export const dedupOffline = (tagId: string) => `${AlarmType.OFFLINE}:${tagId}`;
