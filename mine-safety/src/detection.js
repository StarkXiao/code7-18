/**
 * 检测引擎：每个检测周期由主循环调用一次 tick()，纯逻辑、无定时器，
 * 同一份代码既被系统主循环使用，也被单元测试以"给定世界状态"方式驱动。
 *
 * 三类告警：
 *   zone_entry 进入启用中的危险区域                    等级随区域（危险/警告）
 *   stationary 时间窗内基本不动且持续超过阈值          危险区内 danger / 巷道内 warning
 *   offline    超过阈值未收到 UWB 信号                warning（信号丢失需搜寻）
 *
 * 告警生命周期：active ->（人员恢复/离开/重新上线）resolved；
 *               或调度员 ack（已确认，不再重复广播，事件保留直到自动消除）。
 */
import { zonesContaining } from './geo.js';
import { nextId } from './store.js';

const TYPE_LABEL = {
  zone_entry: '闯入危险区域',
  stationary: '长时间静止',
  offline: '信号丢失',
};

export class DetectionEngine {
  /**
   * @param {import('./store.js').PositionStore} store
   * @param {import('./broadcaster.js').Broadcaster} broadcaster
   * @param {object} cfg
   */
  constructor(store, broadcaster, cfg) {
    this.store = store;
    this.broadcaster = broadcaster;
    this.cfg = cfg;
  }

  /**
   * 推进一个检测周期。
   * @param {number} now 当前时间（毫秒）
   * @returns {Promise<Array<{event:string,data:any}>>} 本周期产生的事件
   */
  async tick(now) {
    const events = [];
    const emit = (event, data) => events.push({ event, data });

    for (const tag of this.store.listTags()) {
      const zones = this.store.zones;
      const prevInside = new Set(tag.prevZoneIds || []);

      if (tag.lastSeenMs == null) continue; // 标签从未上报过位置（尚未入井）

      const offlineMs = now - tag.lastSeenMs;
      const wasOffline = tag.offline;
      const offline = offlineMs > this.cfg.offlineThresholdSec * 1000;
      tag.offline = offline;

      if (wasOffline && !offline) {
        emit('tag.back', { tagId: tag.tagId, at: now });
      }

      if (!offline) {
        // 当前所在区域（只统计启用围栏；离线时保留最后一次结果，不更新）
        const point = { x: tag.x, y: tag.y };
        tag.activeZoneIds = zonesContaining(
          point,
          zones.filter((z) => z.enabled),
        );
        tag.dwellSec = this._updateDwell(tag, now);
      }

      const inside = new Set(tag.activeZoneIds);

      // 1) 区域闯入 / 离开
      for (const zoneId of tag.activeZoneIds) {
        if (!prevInside.has(zoneId)) {
          this._raiseZoneEntry(tag, zoneId, now, emit);
        }
      }

      // 2) 长时间静止（离线标签无法判断，交给离线告警）
      // 停留计时器已带"偏离锚点超过判定半径即清零"的抗噪逻辑，
      // 不再叠加长滑动窗口闸门（否则刚停下的十几秒内窗口仍含行走轨迹，反而延迟告警）。
      if (!offline) {
        const stationary = tag.dwellSec >= this.cfg.stationaryThresholdSec;
        const existing = this.store.findActiveAlarm(tag.tagId, 'stationary');
        if (stationary && !existing) {
          this._raiseStationary(tag, now, emit);
        }
      }

      // 3) 信号丢失
      const offlineAlarm = this.store.findActiveAlarm(tag.tagId, 'offline');
      if (offline && !offlineAlarm) {
        this._raiseOffline(tag, now, offlineMs, emit);
      }

      tag.prevZoneIds = tag.activeZoneIds;
    }

    // 4) 活动告警的自动消除与重复广播
    await this._sweepActiveAlarms(now, emit);

    return events;
  }

  // ── 告警触发 ──────────────────────────────────────────────────────────────

  _raiseZoneEntry(tag, zoneId, now, emit) {
    const zone = this.store.getZone(zoneId);
    const alarm = {
      id: nextId('AL'),
      type: 'zone_entry',
      tagId: tag.tagId,
      workerName: tag.name,
      zoneId,
      zoneName: zone?.name ?? zoneId,
      level: zone?.level === 'warning' ? 'warning' : 'danger',
      message: zone?.message || '危险区域，立即撤离',
      status: 'active',
      raisedAt: now,
      lastBroadcastAt: now,
      x: tag.x,
      y: tag.y,
    };
    this.store.addAlarm(alarm);
    emit('alarm.raised', this._publicAlarm(alarm));
    this._broadcast(alarm, tag, zone, false, emit);
  }

  _raiseStationary(tag, now, emit) {
    const zoneId = tag.activeZoneIds[0] || null;
    const zone = zoneId ? this.store.getZone(zoneId) : null;
    // 危险区域内静止按高危；巷道内静止只发警告（可能只是休息）
    const level = zone ? 'danger' : 'warning';
    const alarm = {
      id: nextId('AL'),
      type: 'stationary',
      tagId: tag.tagId,
      workerName: tag.name,
      zoneId,
      zoneName: zone?.name ?? '安全巷道',
      level,
      message: '人员长时间静止，疑似晕倒或受伤',
      status: 'active',
      raisedAt: now,
      lastBroadcastAt: now,
      dwellSec: tag.dwellSec,
      x: tag.x,
      y: tag.y,
    };
    this.store.addAlarm(alarm);
    emit('alarm.raised', this._publicAlarm(alarm));
    this._broadcast(alarm, tag, zone, false, emit);
  }

  _raiseOffline(tag, now, offlineMs, emit) {
    const zoneId = tag.activeZoneIds[0] || null;
    const zone = zoneId ? this.store.getZone(zoneId) : null;
    const alarm = {
      id: nextId('AL'),
      type: 'offline',
      tagId: tag.tagId,
      workerName: tag.name,
      zoneId,
      zoneName: zone?.name ?? '最后已知位置',
      level: 'warning',
      message: '定位信号长时间丢失',
      status: 'active',
      raisedAt: now,
      lastBroadcastAt: now,
      offlineSec: Math.round(offlineMs / 1000),
      x: tag.x,
      y: tag.y,
    };
    this.store.addAlarm(alarm);
    emit('alarm.raised', this._publicAlarm(alarm));
    // 信号丢失不发警笛、只发一次调度通报（避免重复广播吵扰且无助于搜寻）
    this._broadcast(alarm, tag, zone, false, emit);
  }

  // ── 活动告警扫描 ──────────────────────────────────────────────────────────

  async _sweepActiveAlarms(now, emit) {
    for (const alarm of [...this.store.activeAlarms()]) {
      const tag = this.store.getTag(alarm.tagId);
      if (!tag) continue;
      let shouldResolve = null;

      if (alarm.type === 'zone_entry') {
        if (!tag.activeZoneIds.includes(alarm.zoneId)) {
          shouldResolve = '人员已离开危险区域';
        }
      } else if (alarm.type === 'stationary') {
        if (tag.offline) {
          shouldResolve = '标签转为离线状态';
        } else if (tag.dwellSec < this.cfg.stationaryThresholdSec) {
          shouldResolve = '人员已恢复活动';
        } else {
          alarm.dwellSec = tag.dwellSec;
        }
      } else if (alarm.type === 'offline') {
        if (!tag.offline) shouldResolve = '定位信号恢复';
      }

      if (shouldResolve) {
        this.store.updateAlarm(alarm, {
          status: 'resolved',
          resolvedAt: now,
          resolveReason: shouldResolve,
        });
        emit('alarm.resolved', this._publicAlarm(alarm));
        continue;
      }

      // 重复广播：仅高危、仅未确认、按固定节奏
      const due =
        alarm.level === 'danger' &&
        !alarm.ackedAt &&
        now - (alarm.lastBroadcastAt || alarm.raisedAt) >=
          this.cfg.repeatIntervalSec * 1000;
      if (due) {
        this.store.updateAlarm(alarm, { lastBroadcastAt: now });
        const zone = alarm.zoneId ? this.store.getZone(alarm.zoneId) : null;
        await this._broadcast(alarm, tag, zone, true, emit);
      }
    }
  }

  async _broadcast(alarm, tag, zone, repeat, emit) {
    try {
      const record = await this.broadcaster.send(alarm, tag, zone, { repeat });
      this.store.addBroadcast(record);
      emit('broadcast.sent', record);
    } catch (err) {
      // 广播失败不能把检测循环打挂
      emit('broadcast.failed', { alarmId: alarm.id, error: err.message });
    }
  }

  // ── 静止判定辅助 ──────────────────────────────────────────────────────────

  /**
   * 更新"持续停留秒数"：位置与上一周期相比移动超过判定半径则清零重新计时。
   */
  _updateDwell(tag, now) {
    if (tag.stationarySince == null) {
      tag.stationarySince = now;
      tag._dwellAnchor = { x: tag.x, y: tag.y };
      return 0;
    }
    const anchor = tag._dwellAnchor;
    const moved = Math.hypot(tag.x - anchor.x, tag.y - anchor.y);
    if (moved > this.cfg.stationaryRadiusM) {
      tag.stationarySince = now;
      tag._dwellAnchor = { x: tag.x, y: tag.y };
      return 0;
    }
    return Math.floor((now - tag.stationarySince) / 1000);
  }

  _publicAlarm(a) {
    return {
      ...a,
      typeLabel: TYPE_LABEL[a.type] || a.type,
    };
  }
}
