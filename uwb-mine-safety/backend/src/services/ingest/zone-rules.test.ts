import { describe, expect, it, beforeAll } from 'vitest';
import { setupIntegrationDb } from '../../test/integration-db.js';
import { prisma } from '../../db/prisma.js';
import { ingestPositions, refreshZoneCache } from './pipeline.js';
import { AlarmStatus, AlarmType } from '../../config/constants.js';

const db = setupIntegrationDb();

const ZONE = {
  code: 'Z-T1',
  name: '测试禁区',
  level: 'restricted' as const,
  floor: 0,
  polygon: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ],
  speakerGroup: 'g1',
  broadcastTpl: '警告：{name} 进入{zone}',
};

async function seedPerson() {
  return prisma.person.create({
    data: { tagId: 'TAG-T1', name: '测试员', team: '测试队', status: 'offline' },
  });
}

describe('电子围栏规则', () => {
  let zoneId = '';

  beforeAll(async () => {
    const zone = await prisma.zone.create({ data: { ...ZONE, polygon: ZONE.polygon as never } });
    zoneId = zone.id;
    await seedPerson();
    // 区域走管理接口创建时会主动刷新缓存；直接插库的测试同样需要
    await refreshZoneCache(true);
  });

  it('进入禁区 → 产生 critical 告警 + 自动广播', async () => {
    const r = await ingestPositions([{ tagId: 'TAG-T1', x: 150, y: 150, z: 0 }]);
    expect(r.accepted).toBe(1);
    expect(r.alarmsFired).toBe(1);

    const alarm = await prisma.alarm.findFirstOrThrow({ where: { personId: 'TAG-T1' } });
    expect(alarm.type).toBe(AlarmType.ZONE_INTRUSION);
    expect(alarm.severity).toBe('critical');
    expect(alarm.status).toBe(AlarmStatus.ACTIVE);
    expect(alarm.dedupKey).toBe(`zone_intrusion:TAG-T1:${zoneId}`);

    const broadcast = await prisma.broadcast.findFirstOrThrow({ where: { alarmId: alarm.id } });
    expect(broadcast.content).toBe('警告：测试员 进入测试禁区');
    expect(broadcast.targetGroup).toBe('g1');
    expect(broadcast.status).toBe('sent');
  });

  it('仍在区域内重复上报 → 不产生新告警，只累加 repeatCount', async () => {
    await ingestPositions([{ tagId: 'TAG-T1', x: 151, y: 151, z: 0 }]);
    const alarms = await prisma.alarm.findMany({ where: { personId: 'TAG-T1' } });
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.repeatCount).toBeGreaterThanOrEqual(2);
    // 抑制窗口内不重复广播
    const broadcasts = await prisma.broadcast.count({ where: { alarmId: alarms[0]!.id } });
    expect(broadcasts).toBe(1);
  });

  it('离开区域 → 告警自动解除', async () => {
    await ingestPositions([{ tagId: 'TAG-T1', x: 20, y: 20, z: 0 }]);
    const alarm = await prisma.alarm.findFirstOrThrow({ where: { personId: 'TAG-T1' } });
    expect(alarm.status).toBe(AlarmStatus.RESOLVED);
    expect(alarm.resolveNote).toContain('离开');
  });

  it('warning 区域 → warning 级别且不影响禁区逻辑', async () => {
    await prisma.zone.create({
      data: {
        code: 'Z-T2',
        name: '测试警告区',
        level: 'warning',
        floor: 0,
        polygon: [
          { x: 300, y: 300 },
          { x: 400, y: 300 },
          { x: 400, y: 400 },
          { x: 300, y: 400 },
        ],
      } as never,
    });
    await refreshZoneCache(true);
    await ingestPositions([{ tagId: 'TAG-T1', x: 350, y: 350, z: 0 }]);
    const alarm = await prisma.alarm.findFirstOrThrow({
      where: { personId: 'TAG-T1', type: AlarmType.ZONE_INTRUSION, status: AlarmStatus.ACTIVE },
      include: { zone: true },
    });
    expect(alarm.zone!.name).toBe('测试警告区');
    expect(alarm.severity).toBe('warning');
  });

  it('跨水平（z 不同）不触发围栏', async () => {
    // 先撤到所有围栏外，让警告区告警解除，建立干净基线
    await ingestPositions([{ tagId: 'TAG-T1', x: 500, y: 50, z: 0 }]);
    const before = await prisma.alarm.count({ where: { status: AlarmStatus.ACTIVE } });
    // 坐标在禁区多边形内，但 z=40（另一水平）→ 不应告警
    await ingestPositions([{ tagId: 'TAG-T1', x: 150, y: 150, z: 40 }]);
    const after = await prisma.alarm.count({ where: { status: AlarmStatus.ACTIVE } });
    expect(after).toBe(before);
  });

  it('未登记标签被拒绝且不落库', async () => {
    const r = await ingestPositions([{ tagId: 'TAG-UNKNOWN', x: 1, y: 1, z: 0 }]);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0]?.reason).toContain('未登记');
    const positions = await prisma.position.count({ where: { tagId: 'TAG-UNKNOWN' } });
    expect(positions).toBe(0);
  });
});
