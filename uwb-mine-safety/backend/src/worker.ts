import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { prisma } from './db/prisma.js';
import { detectOffline, reconcileZoneAlarms } from './services/ingest/pipeline.js';
import { escalateStaleAlarms } from './services/alarm/fire.js';

/**
 * Worker：周期性安全扫描。
 * - 离线检测（标签超时无信号）
 * - 围栏对账（弥补进程重启丢失内存状态）
 * - 超时未确认告警升级
 *
 * 这些都必须独立于 API 进程跑：即使定位接入高峰把事件循环打满，
 * 安全扫描也不能被饿死。
 */
async function tick(): Promise<void> {
  try {
    const offline = await detectOffline();
    const reconciled = await reconcileZoneAlarms();
    const escalated = await escalateStaleAlarms();
    if (offline + reconciled + escalated.length > 0) {
      logger.info({ offline, reconciled, escalated: escalated.length }, '安全扫描完成');
    }
  } catch (err) {
    logger.error({ err }, '安全扫描失败');
  }
}

logger.info({ intervalSec: env.scanIntervalSec }, '规则扫描 worker 已启动');
void tick();
const timer = setInterval(() => void tick(), env.scanIntervalSec * 1000);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'worker 关闭中…');
  clearInterval(timer);
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
