import { env } from '../../config/env.js';

/**
 * 规则阈值（秒 / 米 / %）。
 *
 * 默认从环境变量初始化；集成测试通过 setThresholdsForTest 缩短时间阈值，
 * 避免单测真的等两分钟。生产路径从不修改它。
 */
export const thresholds = {
  offlineAfterSec: env.offlineAfterSec,
  stationaryRadiusM: env.stationaryRadiusM,
  stationaryAfterSec: env.stationaryAfterSec,
  lowBatteryPercent: env.lowBatteryPercent,
  dedupWindowSec: env.alarmDedupWindowSec,
  escalateAfterSec: env.alarmEscalateAfterSec,
};

export function setThresholdsForTest(overrides: Partial<typeof thresholds>): void {
  Object.assign(thresholds, overrides);
}
