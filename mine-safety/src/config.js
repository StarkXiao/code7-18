/**
 * 系统配置：所有参数均可通过环境变量覆盖，默认值面向演示场景。
 * 生产部署应通过环境文件 / systemd / 容器注入真实参数。
 */

const env = process.env;

function int(name, fallback) {
  const v = Number.parseInt(env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function float(name, fallback) {
  const v = Number.parseFloat(env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function csv(name, fallback) {
  const v = env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  httpPort: int('HTTP_PORT', 8090),

  // UWB 定位引擎上报通道（UDP，端口与定位引擎约定）
  uwb: {
    enabled: bool('UWB_UDP_ENABLED', true),
    port: int('UWB_UDP_PORT', 5005),
  },

  detection: {
    // 检测循环周期（毫秒）
    intervalMs: int('DETECT_INTERVAL_MS', 1000),
    // 长时静止判定阈值（秒），默认 30s
    stationaryThresholdSec: int('STATIONARY_THRESHOLD_SEC', 30),
    // 静止判定位移半径（米）：窗口内位移范围小于该值视为未移动
    stationaryRadiusM: float('STATIONARY_RADIUS_M', 1.5),
    // 静止判定滑动窗口（秒）
    stationaryWindowSec: int('STATIONARY_WINDOW_SEC', 15),
    // 离线判定：多久收不到 UWB 信号（秒）
    offlineThresholdSec: int('OFFLINE_THRESHOLD_SEC', 15),
  },

  alarm: {
    // 未确认高危告警重复广播间隔（秒）
    repeatIntervalSec: int('ALARM_REPEAT_INTERVAL_SEC', 20),
    // 告警历史保留条数
    historyLimit: int('ALARM_HISTORY_LIMIT', 500),
  },

  broadcast: {
    // 广播渠道：console（声光控制台模拟）/ webhook（第三方调度平台/IP 广播主机）/ sse（前端大屏）
    channels: csv('BROADCAST_CHANNELS', ['console', 'sse']),
    webhookUrl: env.BROADCAST_WEBHOOK_URL || '',
    webhookTimeoutMs: int('BROADCAST_WEBHOOK_TIMEOUT_MS', 3000),
    webhookRetries: int('BROADCAST_WEBHOOK_RETRIES', 2),
  },

  simulator: {
    // 无真实定位引擎时，内置模拟源是否默认开启
    enabled: bool('SIMULATOR_ENABLED', true),
    // UWB 测量噪声（米，1σ）
    noiseM: float('SIMULATOR_NOISE_M', 0.2),
    // 定位上报周期（毫秒）
    reportIntervalMs: int('SIMULATOR_REPORT_INTERVAL_MS', 1000),
  },

  // 运行数据持久化（告警记录、区域配置等）
  dataFile: env.DATA_FILE || new URL('../data/state.json', import.meta.url).pathname,
};
