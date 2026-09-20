import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * 全局 Prisma 单例。
 * 使用 let + installPrismaForTests 是为了让集成测试能注入 PGlite 实例
 * （ESM 命名导入是活绑定，重新赋值后所有 import 方都会拿到新值）。
 */
export let prisma: PrismaClient = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

/** @internal 仅供集成测试替换为内存数据库客户端 */
export function installPrismaForTests(client: PrismaClient): void {
  prisma = client;
}
