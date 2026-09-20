import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PositionStore } from '../src/store.js';
import { DetectionEngine } from '../src/detection.js';

const ZONES = [
  {
    id: 'danger-zone',
    name: '采空区',
    level: 'danger',
    enabled: true,
    message: '严禁进入',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  },
  {
    id: 'warning-zone',
    name: '变电所',
    level: 'warning',
    enabled: true,
    message: '非工作人员禁止入内',
    polygon: [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
    ],
  },
];

function makeEngine(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mine-safety-'));
  const sent = [];
  const store = new PositionStore({
    zones: structuredClone(ZONES),
    tracks: [],
    workers: [{ tagId: 'T1', name: '张三', dept: '综采队', role: '司机' }],
    dataFile: join(dir, 'state.json'),
  });
  const fakeBroadcaster = {
    async send(alarm, worker, zone, opts) {
      const rec = {
        alarmId: alarm.id,
        level: alarm.level,
        type: alarm.type,
        repeat: !!opts.repeat,
        text: `broadcast ${alarm.type}`,
      };
      sent.push(rec);
      store.addBroadcast(rec);
      return rec;
    },
  };
  const cfg = {
    intervalMs: 1000,
    stationaryThresholdSec: 5,
    stationaryRadiusM: 1.5,
    stationaryWindowSec: 5,
    offlineThresholdSec: 10,
    repeatIntervalSec: 3,
    ...overrides,
  };
  const engine = new DetectionEngine(store, fakeBroadcaster, cfg);
  return { store, engine, sent, cfg };
}

const T0 = 1_000_000;

async function feedAndTick(engine, store, positions, start = T0, step = 1000) {
  const allEvents = [];
  positions.forEach((p, i) => {
    store.ingestPosition({ tagId: 'T1', x: p[0], y: p[1], ts: start + i * step });
  });
  const now = start + (positions.length - 1) * step;
  const events = await engine.tick(now);
  allEvents.push(...events);
  return { now, events };
}

describe('危险区域闯入检测', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeEngine();
  });

  it('进入危险区立即产生高危告警并首次广播，离开后自动消除', async () => {
    const { store, engine, sent } = ctx;
    // 先在安全区出现，下一周期进入危险区
    store.ingestPosition({ tagId: 'T1', x: 50, y: 50, ts: T0 });
    await engine.tick(T0);
    assert.equal(store.activeAlarms().length, 0);

    store.ingestPosition({ tagId: 'T1', x: 5, y: 5, ts: T0 + 1000 });
    const events = await engine.tick(T0 + 1000);

    const alarm = store.findActiveAlarm('T1', 'zone_entry', 'danger-zone');
    assert.ok(alarm, '应存在闯入活动告警');
    assert.equal(alarm.level, 'danger');
    assert.equal(sent.filter((b) => b.alarmId === alarm.id && !b.repeat).length, 1);
    assert.ok(events.some((e) => e.event === 'alarm.raised'));

    // 离开后下一周期自动解除
    store.ingestPosition({ tagId: 'T1', x: 50, y: 50, ts: T0 + 2000 });
    await engine.tick(T0 + 2000);
    assert.equal(store.findActiveAlarm('T1', 'zone_entry', 'danger-zone'), undefined);
    assert.equal(alarm.status, 'resolved');
    assert.equal(alarm.resolveReason, '人员已离开危险区域');
  });

  it('停留在区域内不重复产生同区域告警', async () => {
    const { store, engine } = ctx;
    store.ingestPosition({ tagId: 'T1', x: 50, y: 50, ts: T0 });
    await engine.tick(T0);

    for (let i = 1; i <= 4; i++) {
      store.ingestPosition({ tagId: 'T1', x: 5, y: 5, ts: T0 + i * 1000 });
      await engine.tick(T0 + i * 1000);
    }
    const entries = store.alarms.filter(
      (a) => a.type === 'zone_entry' && a.zoneId === 'danger-zone',
    );
    assert.equal(entries.length, 1);
  });

  it('警告级区域产生 warning 告警', async () => {
    const { store, engine } = ctx;
    store.ingestPosition({ tagId: 'T1', x: 25, y: 25, ts: T0 });
    await engine.tick(T0);
    const alarm = store.findActiveAlarm('T1', 'zone_entry', 'warning-zone');
    assert.ok(alarm);
    assert.equal(alarm.level, 'warning');
  });

  it('已禁用的围栏不触发告警', async () => {
    const { store, engine } = ctx;
    store.setZoneEnabled('danger-zone', false);
    store.ingestPosition({ tagId: 'T1', x: 5, y: 5, ts: T0 });
    await engine.tick(T0);
    assert.equal(store.findActiveAlarm('T1', 'zone_entry', 'danger-zone'), undefined);
  });
});

describe('长时间静止检测', () => {
  it('在安全巷道静止超过阈值产生 warning 告警，恢复移动后自动消除', async () => {
    const ctx = makeEngine({ stationaryThresholdSec: 5 });
    const { store, engine } = ctx;
    let now = T0;
    // 持续走动 3 秒
    for (let i = 0; i < 3; i++) {
      store.ingestPosition({ tagId: 'T1', x: 50 + i, y: 50, ts: now });
      await engine.tick(now);
      now += 1000;
    }
    // 原地（带 UWB 抖动）停 6 秒
    for (let i = 0; i < 6; i++) {
      store.ingestPosition({ tagId: 'T1', x: 52 + (i % 2) * 0.3, y: 50, ts: now });
      await engine.tick(now);
      now += 1000;
    }
    const alarm = store.findActiveAlarm('T1', 'stationary');
    assert.ok(alarm, '静止超过阈值应告警');
    assert.equal(alarm.level, 'warning');
    assert.ok(alarm.dwellSec >= 5);

    // 恢复移动
    for (let i = 0; i < 2; i++) {
      store.ingestPosition({ tagId: 'T1', x: 55 + i, y: 50, ts: now });
      await engine.tick(now);
      now += 1000;
    }
    assert.equal(store.findActiveAlarm('T1', 'stationary'), undefined);
    assert.equal(alarm.status, 'resolved');
  });

  it('在危险区内静止为 danger 级', async () => {
    const ctx = makeEngine({ stationaryThresholdSec: 3 });
    const { store, engine } = ctx;
    let now = T0;
    for (let i = 0; i < 5; i++) {
      store.ingestPosition({ tagId: 'T1', x: 5 + (i % 2) * 0.2, y: 5, ts: now });
      await engine.tick(now);
      now += 1000;
    }
    const stationary = store.findActiveAlarm('T1', 'stationary');
    assert.ok(stationary);
    assert.equal(stationary.level, 'danger');
    // 同时存在闯入告警
    assert.ok(store.findActiveAlarm('T1', 'zone_entry', 'danger-zone'));
  });

  it('单纯停留但仍有小幅 UWB 噪声不会误判移动', async () => {
    const ctx = makeEngine({ stationaryThresholdSec: 3, stationaryRadiusM: 1.5 });
    const { store, engine } = ctx;
    let now = T0;
    for (let i = 0; i < 4; i++) {
      store.ingestPosition({ tagId: 'T1', x: 50 + Math.sin(i) * 0.2, y: 50 + Math.cos(i) * 0.2, ts: now });
      await engine.tick(now);
      now += 1000;
    }
    assert.ok(store.findActiveAlarm('T1', 'stationary'));
  });
});

describe('信号丢失检测', () => {
  it('超过离线阈值未收到信号产生 warning，重新上报后自动消除', async () => {
    const ctx = makeEngine({ offlineThresholdSec: 10 });
    const { store, engine } = ctx;
    store.ingestPosition({ tagId: 'T1', x: 50, y: 50, ts: T0 });
    await engine.tick(T0);
    assert.equal(store.activeAlarms().length, 0);

    // 12 秒没有新定位
    let now = T0 + 12_000;
    await engine.tick(now);
    const offline = store.findActiveAlarm('T1', 'offline');
    assert.ok(offline);
    assert.equal(offline.level, 'warning');

    // 信号恢复
    store.ingestPosition({ tagId: 'T1', x: 51, y: 50, ts: now + 1000 });
    await engine.tick(now + 1000);
    assert.equal(store.findActiveAlarm('T1', 'offline'), undefined);
    assert.equal(offline.status, 'resolved');
    assert.equal(offline.resolveReason, '定位信号恢复');
  });
});

describe('重复广播与调度确认', () => {
  it('高危告警按节奏重复广播，确认后停止重复', async () => {
    const ctx = makeEngine({ repeatIntervalSec: 3, offlineThresholdSec: 999 });
    const { store, engine, sent } = ctx;
    store.ingestPosition({ tagId: 'T1', x: 5, y: 5, ts: T0 });
    await engine.tick(T0);
    const alarm = store.findActiveAlarm('T1', 'zone_entry', 'danger-zone');
    assert.ok(alarm);

    // 3 秒后仍在区域内 -> 第一次重复
    await engine.tick(T0 + 3000);
    assert.equal(sent.filter((b) => b.alarmId === alarm.id).length, 2);
    // 6 秒后 -> 第二次重复
    await engine.tick(T0 + 6000);
    assert.equal(sent.filter((b) => b.alarmId === alarm.id).length, 3);

    // 调度员确认
    store.updateAlarm(alarm, { ackedAt: T0 + 7000, ackedBy: '值班调度' });
    await engine.tick(T0 + 9000);
    assert.equal(sent.filter((b) => b.alarmId === alarm.id).length, 3, '确认后不应再重复广播');
    // 告警仍处于活动状态（人员还在区域里），只是不再吵
    assert.equal(alarm.status, 'active');
  });

  it('警告级告警不重复广播', async () => {
    const ctx = makeEngine({ repeatIntervalSec: 1 });
    const { store, engine, sent } = ctx;
    store.ingestPosition({ tagId: 'T1', x: 25, y: 25, ts: T0 });
    await engine.tick(T0);
    await engine.tick(T0 + 5000);
    const count = sent.filter((b) => b.type === 'zone_entry').length;
    assert.equal(count, 1);
  });
});

describe('重启恢复', () => {
  it('落盘文件中未结束的活动告警在重新加载后自动复位为 resolved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mine-safety-restart-'));
    const file = join(dir, 'state.json');
    {
      const store = new PositionStore({
        zones: structuredClone(ZONES),
        tracks: [],
        workers: [{ tagId: 'T1', name: '张三' }],
        dataFile: file,
      });
      store.ingestPosition({ tagId: 'T1', x: 5, y: 5, ts: T0 });
      store.addAlarm({
        id: 'AL1',
        type: 'zone_entry',
        tagId: 'T1',
        zoneId: 'danger-zone',
        level: 'danger',
        status: 'active',
        raisedAt: T0,
      });
      store.persist();
    }
    const store2 = new PositionStore({
      zones: structuredClone(ZONES),
      tracks: [],
      workers: [],
      dataFile: file,
    });
    const a = store2.alarms.find((x) => x.id === 'AL1');
    assert.equal(a.status, 'resolved');
    assert.match(a.resolveReason, /重启/);
  });
});
