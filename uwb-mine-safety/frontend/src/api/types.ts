// 与后端 constants 对齐
export type PersonStatus = 'active' | 'stationary' | 'offline';
export type AlarmType = 'zone_intrusion' | 'stationary' | 'sos' | 'low_battery' | 'offline';
export type AlarmSeverity = 'info' | 'warning' | 'critical';
export type AlarmStatus = 'active' | 'acked' | 'resolved';
export type ZoneLevel = 'restricted' | 'warning' | 'safe';
export type Role = 'admin' | 'dispatcher' | 'viewer';

export interface Point {
  x: number;
  y: number;
}

export interface Person {
  tagId: string;
  name: string;
  employeeNo?: string | null;
  jobTitle?: string | null;
  team?: string | null;
  phone?: string | null;
  batteryPct?: number | null;
  status: PersonStatus;
  lastPos?: { x: number; y: number; z: number } | null;
  lastSeenAt?: string | null;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  level: ZoneLevel;
  polygon: Point[];
  floor: number;
  speakerGroup?: string | null;
  broadcastTpl?: string | null;
  isActive: boolean;
  remark?: string | null;
  _count?: { anchors: number };
}

export interface Alarm {
  id: string;
  type: AlarmType;
  severity: AlarmSeverity;
  status: AlarmStatus;
  personId: string;
  zoneId?: string | null;
  dedupKey: string;
  position?: { x: number; y: number; z: number } | null;
  message: string;
  repeatCount: number;
  lastFiredAt: string;
  firstFiredAt: string;
  ackedAt?: string | null;
  ackedByName?: string | null;
  resolvedAt?: string | null;
  resolveNote?: string | null;
  escalatedAt?: string | null;
  createdAt?: string;
  person?: Pick<Person, 'tagId' | 'name' | 'team' | 'phone' | 'jobTitle'>;
  zone?: Pick<Zone, 'id' | 'name' | 'level'>;
}

export interface Broadcast {
  id: string;
  alarmId?: string | null;
  triggerType: 'auto' | 'manual' | string;
  targetGroup?: string | null;
  content: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
