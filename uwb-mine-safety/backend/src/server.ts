import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { prisma } from './db/prisma.js';
import { realtimeHub } from './services/realtime/index.js';

const app = createApp();
const server = createServer(app);

/**
 * 实时通道：/ws
 * 大屏只读，允许匿名接入（调度室内网）；如需鉴权可在 upgrade 时校验
 * Authorization 头或 ?token=，此处保留最小实现。
 */
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  realtimeHub.add(ws);
  ws.send(JSON.stringify({ type: 'stats', data: { hello: true } }));
  logger.debug({ ip: req.socket.remoteAddress }, 'WS 客户端接入');
});

server.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, '井下人员定位安全系统 API 已启动');
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, '正在关闭服务…');
  wss.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
