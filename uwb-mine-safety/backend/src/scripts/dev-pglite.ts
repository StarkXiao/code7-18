/**
 * 本地无 Docker 演示入口：PGlite（内存 PostgreSQL）+ 迁移 + 种子 + API + Worker。
 *
 * 生产用 docker compose（真实 Postgres）；本脚本仅用于在没有数据库的机器上
 * 一条命令跑起完整系统配合 npm run simulate 演示。
 */
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { installPrismaForTests } from '../db/prisma.js';
import { createApp } from '../app.js';
import { realtimeHub } from '../services/realtime/index.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { detectOffline, reconcileZoneAlarms, refreshZoneCache } from '../services/ingest/pipeline.js';
import { escalateStaleAlarms } from '../services/alarm/fire.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const pglite = new PGlite();
  const sql = await readFile(resolve(here, '../../prisma/migrations/20260901000000_init/migration.sql'), 'utf8');
  await pglite.exec(sql);

  const client = new PrismaClient({ adapter: new PrismaPGlite(pglite) } as never);
  installPrismaForTests(client);

  // 种子（复用 seed.ts 的 main，但它自带 client——改为直接内联最小种子）
  await seed(client);
  await refreshZoneCache(true);

  const app = createApp();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => realtimeHub.add(ws));

  server.listen(env.port, () => {
    logger.info({ port: env.port }, '演示模式（PGlite）已启动：http://localhost:3000');
    logger.info('另开终端运行 npm run simulate 推送模拟定位');
  });

  // worker 扫描
  setInterval(() => {
    void detectOffline();
    void reconcileZoneAlarms();
    void escalateStaleAlarms();
  }, env.scanIntervalSec * 1000);
}

async function seed(client: PrismaClient) {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.default.hash('admin123', 10);
  for (const [username, displayName, role] of [
    ['admin', '系统管理员', 'admin'],
    ['dispatcher', '王调度', 'dispatcher'],
    ['viewer', '值班长', 'viewer'],
  ] as const) {
    await client.user.upsert({ where: { username }, update: {}, create: { username, passwordHash, displayName, role } });
  }

  const zones = [
    { code: 'Z-001', name: '中央变电所', level: 'restricted' as const, floor: 0,
      polygon: [{ x: 320, y: 80 }, { x: 420, y: 80 }, { x: 420, y: 160 }, { x: 320, y: 160 }],
      speakerGroup: 'zone-001', broadcastTpl: '警告：{name}（{team}）已进入{zone}，请立即撤离！' },
    { code: 'Z-002', name: '采空区边缘', level: 'restricted' as const, floor: 0,
      polygon: [{ x: 700, y: 300 }, { x: 820, y: 300 }, { x: 840, y: 420 }, { x: 720, y: 440 }],
      speakerGroup: 'zone-002', broadcastTpl: '危险：{name} 已接近{zone}，禁止越过警戒线！' },
    { code: 'Z-003', name: '瓦斯巡检巷', level: 'warning' as const, floor: 0,
      polygon: [{ x: 150, y: 320 }, { x: 260, y: 320 }, { x: 260, y: 420 }, { x: 150, y: 420 }],
      speakerGroup: 'zone-003', broadcastTpl: '提醒：{name} 进入{zone}，请加强观察。' },
  ];
  for (const z of zones) await client.zone.upsert({ where: { code: z.code }, update: {}, create: z as never });

  const people = [
    ['TAG-001', '李矿生', '采煤工', '综采一队'], ['TAG-002', '张安全', '安全员', '安检科'],
    ['TAG-003', '王大力', '采煤工', '综采一队'], ['TAG-004', '赵电工', '电工', '机电队'],
    ['TAG-005', '刘巡检', '瓦斯检查工', '通风队'], ['TAG-006', '陈运输', '电机车司机', '运输队'],
    ['TAG-007', '孙立柱', '支护工', '掘进二队'], ['TAG-008', '周通风', '测风工', '通风队'],
    ['TAG-009', '吴机修', '机修工', '机电队'], ['TAG-010', '郑放炮', '爆破工', '掘进二队'],
    ['TAG-011', '冯班长', '班长', '综采一队'], ['TAG-012', '蒋抽水', '排水工', '机电队'],
  ] as const;
  for (const [tagId, name, jobTitle, team] of people) {
    await client.person.upsert({ where: { tagId }, update: {}, create: { tagId, name, jobTitle, team } });
  }

  await client.ingestKey.upsert({
    where: { key: 'uwb_dev_ingest_key_change_me_in_production_0001' },
    update: { isActive: true },
    create: { key: 'uwb_dev_ingest_key_change_me_in_production_0001', name: '演示' },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
