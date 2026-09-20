import 'dotenv/config';

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: num('APP_PORT', 3000),
  baseUrl: str('APP_BASE_URL', 'http://localhost:3000'),
  frontendBaseUrl: str('FRONTEND_BASE_URL', 'http://localhost:5173'),
  logLevel: str('LOG_LEVEL', 'info'),

  databaseUrl: str('DATABASE_URL', 'postgresql://app:app@localhost:5432/uwb_mine?schema=public'),

  jwtSecret: str('JWT_SECRET', 'local-development-secret-change-me-32chars'),
  jwtAccessTtlSec: num('JWT_ACCESS_TTL', 900),

  // ---- 定位接入 ----
  // 超过该秒数未收到标签位置即判定离线
  offlineAfterSec: num('PERSON_OFFLINE_AFTER_SEC', 90),
  // 静止判定：位移半径（米）与持续时长（秒）
  stationaryRadiusM: num('STATIONARY_RADIUS_M', 3),
  stationaryAfterSec: num('STATIONARY_AFTER_SEC', 120),
  // 同类型告警去重抑制窗口（秒），窗口内只累加 repeat_count
  alarmDedupWindowSec: num('ALARM_DEDUP_WINDOW_SEC', 300),
  // 告警产生后超时未确认则升级（秒）
  alarmEscalateAfterSec: num('ALARM_ESCALATE_AFTER_SEC', 300),
  // 低电量阈值
  lowBatteryPercent: num('LOW_BATTERY_PERCENT', 15),
  // 位置数据最大批大小
  ingestMaxBatch: num('INGEST_MAX_BATCH', 500),

  // ---- 广播 ----
  broadcastDriver: str('BROADCAST_DRIVER', 'console'), // console | webhook
  broadcastWebhookUrl: str('BROADCAST_WEBHOOK_URL', ''),
  broadcastTimeoutMs: num('BROADCAST_TIMEOUT_MS', 5000),

  // 扫描周期（秒）：离线检测、告警升级
  scanIntervalSec: num('SCAN_INTERVAL_SEC', 10),
} as const;
