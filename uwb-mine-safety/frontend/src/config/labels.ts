import type { AlarmSeverity, AlarmStatus, AlarmType, PersonStatus, ZoneLevel } from '../api/types';

export const ALARM_LABELS: Record<AlarmType, string> = {
  zone_intrusion: '闯入危险区域',
  stationary: '长时间静止',
  sos: '紧急求救',
  low_battery: '标签低电量',
  offline: '标签离线',
};

export const STATUS_LABELS: Record<PersonStatus, string> = {
  active: '正常',
  stationary: '静止',
  offline: '离线',
};

export const ZONE_LEVEL_LABELS: Record<ZoneLevel, string> = {
  restricted: '禁止进入',
  warning: '谨慎进入',
  safe: '安全区域',
};

export function typeLabel(t: AlarmType): string {
  return ALARM_LABELS[t] ?? t;
}

export function statusLabel(s: AlarmStatus): string {
  return { active: '待确认', acked: '处置中', resolved: '已解除' }[s] ?? s;
}

export function statusType(s: AlarmStatus): 'danger' | 'warning' | 'success' | 'info' {
  return ({ active: 'danger', acked: 'warning', resolved: 'success' } as const)[s] ?? 'info';
}

export function sevType(s: AlarmSeverity): 'danger' | 'warning' | 'info' {
  return ({ critical: 'danger', warning: 'warning', info: 'info' } as const)[s] ?? 'info';
}

export function severityLabel(s: AlarmSeverity): string {
  return ({ critical: '紧急', warning: '警告', info: '提示' } as const)[s] ?? s;
}

export function broadcastStatusLabel(s: 'sent' | 'failed' | 'pending' | string): string {
  return ({ sent: '已下发', failed: '失败', pending: '待下发' } as Record<string, string>)[s] ?? s;
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtRelative(v: string | null | undefined): string {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.round(hr / 24)} 天前`;
}

export function batteryType(pct: number | null | undefined): 'danger' | 'warning' | 'success' {
  if (pct === null || pct === undefined) return 'success';
  if (pct <= 15) return 'danger';
  if (pct <= 30) return 'warning';
  return 'success';
}
