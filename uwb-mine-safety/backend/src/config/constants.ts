export const PersonStatus = {
  ACTIVE: 'active', // 正常移动
  STATIONARY: 'stationary', // 静止观察中（达到静止规则阈值）
  OFFLINE: 'offline', // 标签超时未上报
} as const;
export type PersonStatus = (typeof PersonStatus)[keyof typeof PersonStatus];

export const AlarmType = {
  ZONE_INTRUSION: 'zone_intrusion', // 闯入危险区域
  STATIONARY: 'stationary', // 长时间静止
  SOS: 'sos', // 标签主动求救
  LOW_BATTERY: 'low_battery', // 标签低电量
  OFFLINE: 'offline', // 标签离线
} as const;
export type AlarmType = (typeof AlarmType)[keyof typeof AlarmType];

export const AlarmSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;
export type AlarmSeverity = (typeof AlarmSeverity)[keyof typeof AlarmSeverity];

export const AlarmStatus = {
  ACTIVE: 'active',
  ACKED: 'acked',
  RESOLVED: 'resolved',
} as const;
export type AlarmStatus = (typeof AlarmStatus)[keyof typeof AlarmStatus];

export const ZoneLevel = {
  RESTRICTED: 'restricted', // 禁止进入（红区）
  WARNING: 'warning', // 谨慎进入（黄区）
  SAFE: 'safe', // 安全区域（仅展示，不告警）
} as const;
export type ZoneLevel = (typeof ZoneLevel)[keyof typeof ZoneLevel];

/** 不同区域级别触发告警的严重度 */
export const ZONE_SEVERITY: Record<string, AlarmSeverity> = {
  restricted: 'critical',
  warning: 'warning',
  safe: 'info',
};

/** 各告警类型默认严重度（区域闯入以区域级别为准） */
export const TYPE_SEVERITY: Record<AlarmType, AlarmSeverity> = {
  zone_intrusion: 'critical',
  stationary: 'warning',
  sos: 'critical',
  low_battery: 'info',
  offline: 'warning',
};

/** 告警类型中文展示名 */
export const ALARM_TYPE_LABEL: Record<AlarmType, string> = {
  zone_intrusion: '闯入危险区域',
  stationary: '长时间静止',
  sos: '紧急求救',
  low_battery: '标签低电量',
  offline: '标签离线',
};

export const BroadcastStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;
export type BroadcastStatus = (typeof BroadcastStatus)[keyof typeof BroadcastStatus];
