/**
 * 组装给调度大屏的全量状态快照（SSE 首帧 / GET /api/state）。
 */
import { locationLabel } from './geo.js';

export function buildSnapshot(store, { sim, uwb, hub, detectionCfg } = {}) {
  const now = Date.now();
  const tags = store.listTags().map((t) => {
    let label = { offsetM: null };
    if (t.lastSeenMs != null) {
      label = locationLabel({ x: t.x, y: t.y }, store.zones, store.tracks);
    }
    return {
      tagId: t.tagId,
      name: t.name,
      dept: t.dept,
      role: t.role,
      unknown: !!t.unknown,
      x: t.x,
      y: t.y,
      z: t.z,
      floor: t.floor,
      lastSeenMs: t.lastSeenMs,
      offline: t.offline,
      ageSec: t.lastSeenMs == null ? null : Math.max(0, Math.round((now - t.lastSeenMs) / 1000)),
      dwellSec: t.dwellSec || 0,
      zones: t.activeZoneIds
        .map((id) => store.getZone(id))
        .filter(Boolean)
        .map((z) => ({ id: z.id, name: z.name, level: z.level })),
      location: label,
      activeAlarmIds: store
        .activeAlarms()
        .filter((a) => a.tagId === t.tagId)
        .map((a) => a.id),
    };
  });

  const alarms = store.alarms.slice(0, 100).map(publicAlarm);

  return {
    now,
    startedAt: store.startedAt,
    serverTime: new Date(now).toISOString(),
    map: { tracks: store.tracks },
    zones: store.zones.map((z) => ({ ...z })),
    tags,
    alarms,
    broadcasts: store.broadcasts.slice(0, 50),
    stats: {
      total: tags.length,
      underground: tags.filter((t) => t.lastSeenMs != null).length,
      offline: tags.filter((t) => t.offline).length,
      activeAlarms: alarms.filter((a) => a.status === 'active').length,
      unackedDanger: alarms.filter((a) => a.status === 'active' && a.level === 'danger' && !a.ackedAt).length,
      sseClients: hub?.size ?? 0,
    },
    uwb: uwb
      ? { port: uwb.port, ...uwb.stats }
      : null,
    simulator: sim
      ? { enabled: true, running: sim.running, scenario: sim.scenario }
      : { enabled: false },
    config: {
      stationaryThresholdSec: detectionCfg.stationaryThresholdSec,
      stationaryRadiusM: detectionCfg.stationaryRadiusM,
      stationaryWindowSec: detectionCfg.stationaryWindowSec,
      offlineThresholdSec: detectionCfg.offlineThresholdSec,
    },
  };
}

export function publicAlarm(a) {
  const typeLabel = {
    zone_entry: '闯入危险区域',
    stationary: '长时间静止',
    offline: '信号丢失',
  }[a.type] || a.type;
  return { ...a, typeLabel };
}
