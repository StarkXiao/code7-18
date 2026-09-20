import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { installPrismaForTests } from '../db/prisma.js';
import { refreshZoneCache, _resetRuleStateForTest } from '../services/ingest/pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = resolve(here, '../../prisma/migrations/20260901000000_init/migration.sql');

export interface TestDb {
  pglite: PGlite;
  prisma: PrismaClient;
}

/**
 * 真实 PostgreSQL（WASM 版 PGlite）+ 真实迁移 SQL 的集成测试基座。
 * 每个测试文件拿到全新库；迁移 SQL 直接执行，等于验证了迁移本身可用。
 */
export function setupIntegrationDb(): TestDb {
  const state: TestDb = {} as TestDb;

  beforeAll(async () => {
    const pglite = new PGlite();
    const sql = await readFile(MIGRATION_SQL, 'utf8');
    await pglite.exec(sql);

    const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) } as never);
    state.pglite = pglite;
    state.prisma = prisma;
    installPrismaForTests(prisma);
    _resetRuleStateForTest();
    await refreshZoneCache(true);
  }, 30_000);

  return state;
}
