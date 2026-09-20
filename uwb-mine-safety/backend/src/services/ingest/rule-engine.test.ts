import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { setupIntegrationDb } from '../../test/integration-db.js';
import { prisma } from '../../db/prisma.js';
import { ingestPositions, detectOffline, _resetRuleStateForTest } from './pipeline.js';
import { escalateStaleAlarms, fireAlarm } from '../alarm/fire.js';
import { setThresholdsForTest } from '../tracking/config.js';
import { AlarmStatus, AlarmType } from '../../config/constants.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

setupIntegrationDb();

beforeEach(() => {
  _resetRuleStateForTest();
  setThresholdsForTest({
    stationaryAfterSec: 1,
    stationaryRadiusM: 3,
    offlineAfterSec: 2,
    lowBatteryPercent: 15,
    dedupWindowSec: 1,
    escalateAfterSec: 1,
  });
});

describe('长时间静止规则', () => {
  it('静止超过阈值 → 告警并标记 stationary；恢复移动 → 自动解除', async () => {
    await prisma.person.create({
      data: { tagId: 'TAG-S1', name: '静止员', team: '一队', status: 'active' },
    });

    // 1.2 秒内连续上报同位置（含 UWB 级抖动）
    let fired = 0;
    for (let i = 0; i < 7; i++) {
      const r = await ingestPositions([{
        tagId: 'TAG-S1',
        x: 100 + (Math.random() - 0.5) * 0.4,
        y: 100 + (Math.random() - 0.5) * 0.4,
        z: 0,
        measuredAt: Date.now(),
      }]);
      fired += r.alarmsFired;
      await sleep(200);
    }
    expect(fired).toBe(1);

    const person = await prisma.person.findUniqueOrThrow({ where: { tagId: 'TAG-S1' } });
    expect(person.status).toBe('stationary');

    const alarm = await prisma.alarm.findFirstOrThrow({
      where: { personId: 'TAG-S1', type: AlarmType.STATIONARY, status: AlarmStatus.ACTIVE },
    });
    // 静止告警要联动广播
    const bc = await prisma.broadcast.findFirstOrThrow({ where: { alarmId: alarm.id } });
    expect(bc.content).toContain('静止');

    // 移动离开
    await ingestPositions([{ tagId: 'TAG-S1', x: 130, y: 130, z: 0, measuredAt: Date.now() }]);
    const resolved = await prisma.alarm.findUniqueOrThrow({ where: { id: alarm.id } });
    expect(resolved.status).toBe(AlarmStatus.RESOLVED);
    const moved = await prisma.person.findUniqueOrThrow({ where: { tagId: 'TAG-S1' } });
    expect(moved.status).toBe('active');
  }, 15_000);
});

describe('SOS 规则', () => {
  it('SOS → critical + 广播，且不允许被自动解除', async () => {
    await prisma.person.create({
      data: { tagId: 'TAG-SOS', name: '求救员', team: '二队', status: 'active' },
    });
    await ingestPositions([{ tagId: 'TAG-SOS', x: 1, y: 2, z: 0, sos: true }]);

    const alarm = await prisma.alarm.findFirstOrThrow({ where: { personId: 'TAG-SOS', type: AlarmType.SOS } });
    expect(alarm.severity).toBe('critical');
    expect(alarm.status).toBe(AlarmStatus.ACTIVE);

    const bc = await prisma.broadcast.findFirstOrThrow({ where: { alarmId: alarm.id } });
    expect(bc.content).toContain('求救');

    // 即使后续定位正常移动，SOS 仍保持未解除
    await ingestPositions([{ tagId: 'TAG-SOS', x: 50, y: 50, z: 0 }]);
    const still = await prisma.alarm.findUniqueOrThrow({ where: { id: alarm.id } });
    expect(still.status).not.toBe(AlarmStatus.RESOLVED);
  });
});

describe('低电量规则', () => {
  it('低于阈值 → info 告警但不广播；充电恢复（迟滞）→ 自动解除', async () => {
    await prisma.person.create({
      data: { tagId: 'TAG-B1', name: '低电工', team: '三队', status: 'active' },
    });
    const r1 = await ingestPositions([{ tagId: 'TAG-B1', x: 1, y: 1, z: 0, batteryPct: 10 }]);
    expect(r1.alarmsFired).toBe(1);

    const alarm = await prisma.alarm.findFirstOrThrow({ where: { personId: 'TAG-B1', type: AlarmType.LOW_BATTERY } });
    expect(alarm.severity).toBe('info');
    expect(await prisma.broadcast.count({ where: { alarmId: alarm.id } })).toBe(0);

    // 阈值附近（12%）不重复告警
    const r2 = await ingestPositions([{ tagId: 'TAG-B1', x: 1, y: 1, z: 0, batteryPct: 12 }]);
    expect(r2.alarmsFired).toBe(0);

    // 恢复到阈值+5% 才解除
    await ingestPositions([{ tagId: 'TAG-B1', x: 1, y: 1, z: 0, batteryPct: 20 }]);
    const resolved = await prisma.alarm.findUniqueOrThrow({ where: { id: alarm.id } });
    expect(resolved.status).toBe(AlarmStatus.RESOLVED);
  });
});

describe('离线检测（worker 周期任务）', () => {
  it('超时未上报 → 离线状态 + offline 告警；重新上报 → 自动解除', async () => {
    await prisma.person.create({
      data: {
        tagId: 'TAG-O1',
        name: '失联员',
        team: '四队',
        status: 'active',
        lastSeenAt: new Date(Date.now() - 30_000),
        lastPos: { x: 5, y: 5, z: 0 },
      },
    });

    const count = await detectOffline();
    expect(count).toBe(1);
    const person = await prisma.person.findUniqueOrThrow({ where: { tagId: 'TAG-O1' } });
    expect(person.status).toBe('offline');
    const alarm = await prisma.alarm.findFirstOrThrow({ where: { personId: 'TAG-O1', type: AlarmType.OFFLINE } });
    expect(alarm.status).toBe(AlarmStatus.ACTIVE);

    // 恢复上报
    await ingestPositions([{ tagId: 'TAG-O1', x: 6, y: 6, z: 0, measuredAt: Date.now() }]);
    const resolved = await prisma.alarm.findUniqueOrThrow({ where: { id: alarm.id } });
    expect(resolved.status).toBe(AlarmStatus.RESOLVED);
    const back = await prisma.person.findUniqueOrThrow({ where: { tagId: 'TAG-O1' } });
    expect(back.status).not.toBe('offline');
  });
});

describe('告警升级（worker 周期任务）', () => {
  it('warning 告警超时未确认 → 升级 critical 并全矿广播', async () => {
    await prisma.person.create({
      data: { tagId: 'TAG-E1', name: '升级员', team: '五队', status: 'active' },
    });
    await fireAlarm({
      type: AlarmType.STATIONARY,
      person: { tagId: 'TAG-E1', name: '升级员', team: '五队' },
      dedupKey: 'stationary:TAG-E1',
      message: '静止',
    });

    // 把 lastFiredAt 调到阈值之前
    await prisma.alarm.updateMany({
      where: { dedupKey: 'stationary:TAG-E1' },
      data: { lastFiredAt: new Date(Date.now() - 30_000) },
    });

    const escalated = await escalateStaleAlarms();
    expect(escalated).toHaveLength(1);
    expect(escalated[0]!.severity).toBe('critical');
    expect(escalated[0]!.escalatedAt).toBeTruthy();

    // 原始静止广播 1 条 + 升级提醒广播 1 条
    const broadcasts = await prisma.broadcast.count({ where: { alarmId: escalated[0]!.id } });
    expect(broadcasts).toBe(2);

    // info 级（低电量）告警即使超时也不升级
    await prisma.alarm.create({
      data: {
        type: AlarmType.LOW_BATTERY,
        severity: 'info',
        status: AlarmStatus.ACTIVE,
        personId: 'TAG-E1',
        dedupKey: 'low_battery:TAG-E1',
        message: '低电量',
        lastFiredAt: new Date(Date.now() - 30_000),
      },
    });
    const second = await escalateStaleAlarms();
    expect(second).toHaveLength(0);
    const infoAlarm = await prisma.alarm.findFirstOrThrow({ where: { dedupKey: 'low_battery:TAG-E1' } });
    expect(infoAlarm.severity).toBe('info');
    expect(infoAlarm.escalatedAt).toBeNull();
  });
});

describe('并发去重', () => {
  it('同一去重键并发触发 → 只有一条未决告警，另一次累加为重复', async () => {
    await prisma.person.create({
      data: { tagId: 'TAG-C1', name: '并发员', team: '六队', status: 'active' },
    });
    const input: {
      type: AlarmType;
      person: { tagId: string; name: string; team: string };
      dedupKey: string;
      message: string;
    } = {
      type: AlarmType.ZONE_INTRUSION,
      person: { tagId: 'TAG-C1', name: '并发员', team: '六队' },
      dedupKey: 'zone_intrusion:TAG-C1:zone-x',
      message: '并发闯入',
    };
    const [a, b] = await Promise.all([fireAlarm(input), fireAlarm(input)]);

    const open = await prisma.alarm.findMany({
      where: { dedupKey: input.dedupKey, status: { in: [AlarmStatus.ACTIVE, AlarmStatus.ACKED] } },
    });
    expect(open).toHaveLength(1);
    expect(a.alarm.id).toBe(b.alarm.id);
    expect(open[0]!.repeatCount).toBe(2);
  });
});
