/**
 * 实时位置存储：内存态 + JSON 落盘。
 * - 标签实时轨迹只保留在内存中（重启后由定位引擎重新上报自然恢复）；
 * - 危险区域配置、人员档案、告警记录持久化；
 * - 重启时所有未结束告警自动复位（进程不在 = 无法保证监控连续性，不能让旧警情悬挂）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_SAMPLES = 180; // 每个标签最多保留的定位点数（1Hz 下约 3 分钟）

let idSeq = 0;
export function nextId(prefix) {
  idSeq += 1;
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}${p(
    t.getHours(),
  )}${p(t.getMinutes())}${p(t.getSeconds())}-${String(idSeq).padStart(4, '0')}`;
}

export class PositionStore {
  constructor({ zones, tracks, workers, dataFile, historyLimit = 500 }) {
    this.tracks = tracks;
    this.zones = zones;
    this.dataFile = dataFile;
    this.historyLimit = historyLimit;

    /** @type {Map<string, any>} tagId -> 运行时标签态 */
    this.tags = new Map();
    /** @type {any[]} 告警记录（新的在前） */
    this.alarms = [];
    /** @type {any[]} 广播记录（新的在前） */
    this.broadcasts = [];
    this.startedAt = Date.now();

    for (const w of workers) this.registerTag(w);
    this._persistTimer = null;
    this._load();
  }

  registerTag(info) {
    const existing = this.tags.get(info.tagId);
    if (existing) {
      Object.assign(existing, info);
      return existing;
    }
    const tag = {
      tagId: info.tagId,
      name: info.name || info.tagId,
      dept: info.dept || '',
      role: info.role || '',
      x: null,
      y: null,
      z: 0,
      floor: 1,
      lastSeenMs: null,
      history: [],
      activeZoneIds: [],
      prevZoneIds: [],
      stationarySince: null,
      dwellSec: 0,
      offline: true,
      unknown: !!info.unknown,
    };
    this.tags.set(info.tagId, tag);
    return tag;
  }

  /**
   * 接收一条 UWB 定位结果。
   * @param {{tagId:string,x:number,y:number,z?:number,ts?:number}} pos
   */
  ingestPosition(pos) {
    if (!pos || !pos.tagId || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      throw new Error('定位数据格式非法：需要 tagId 与数值型 x/y');
    }
    let tag = this.tags.get(pos.tagId);
    if (!tag) {
      // 定位引擎里出现但系统未建档的标签：先接住，不能因为没建档就丢掉一个井下活人
      tag = this.registerTag({ tagId: pos.tagId, name: pos.tagId, unknown: true });
    }
    const now = Number.isFinite(pos.ts) ? pos.ts : Date.now();
    tag.x = pos.x;
    tag.y = pos.y;
    tag.z = Number.isFinite(pos.z) ? pos.z : tag.z;
    tag.lastSeenMs = now;
    tag.history.push({ x: tag.x, y: tag.y, t: now });
    if (tag.history.length > MAX_SAMPLES) tag.history.shift();
    tag.offline = false;
    return tag;
  }

  getTag(tagId) {
    return this.tags.get(tagId);
  }

  listTags() {
    return [...this.tags.values()];
  }

  getZone(zoneId) {
    return this.zones.find((z) => z.id === zoneId);
  }

  setZoneEnabled(zoneId, enabled) {
    const z = this.getZone(zoneId);
    if (!z) return false;
    z.enabled = enabled;
    this.schedulePersist();
    return true;
  }

  addAlarm(alarm) {
    this.alarms.unshift(alarm);
    if (this.alarms.length > this.historyLimit) this.alarms.length = this.historyLimit;
    this.schedulePersist();
  }

  updateAlarm(alarm, patch) {
    Object.assign(alarm, patch);
    this.schedulePersist();
  }

  findActiveAlarm(tagId, type, zoneId = null) {
    return this.alarms.find(
      (a) =>
        a.status === 'active' &&
        a.tagId === tagId &&
        a.type === type &&
        (type !== 'zone_entry' || a.zoneId === zoneId),
    );
  }

  activeAlarms() {
    return this.alarms.filter((a) => a.status === 'active');
  }

  addBroadcast(entry) {
    this.broadcasts.unshift(entry);
    if (this.broadcasts.length > 200) this.broadcasts.length = 200;
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persist();
    }, 1500);
    this._persistTimer.unref?.();
  }

  persist() {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      zones: this.zones,
      workers: this.listTags()
        .filter((t) => !t.unknown)
        .map((t) => ({ tagId: t.tagId, name: t.name, dept: t.dept, role: t.role })),
      alarms: this.alarms,
    };
    mkdirSync(dirname(this.dataFile), { recursive: true });
    writeFileSync(this.dataFile, JSON.stringify(payload, null, 2));
  }

  _load() {
    let raw;
    try {
      raw = readFileSync(this.dataFile, 'utf8');
    } catch {
      return; // 首次运行，无历史文件
    }
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data.zones) && data.zones.length) this.zones = data.zones;
      if (Array.isArray(data.workers)) {
        for (const w of data.workers) this.registerTag(w);
      }
      if (Array.isArray(data.alarms)) {
        const restartedAt = Date.now();
        this.alarms = data.alarms.slice(0, this.historyLimit).map((a) =>
          a.status === 'active'
            ? {
                ...a,
                status: 'resolved',
                resolvedAt: a.resolvedAt ?? restartedAt,
                resolveReason: '系统重启，告警自动复位',
              }
            : a,
        );
      }
    } catch (err) {
      // 落盘文件损坏不能阻塞启动：以默认配置起来，并把坏文件留在现场供排查
      console.error(`[store] 历史数据文件解析失败，使用默认配置启动: ${err.message}`);
    }
  }
}
