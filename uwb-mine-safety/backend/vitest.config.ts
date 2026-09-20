import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // PGlite 在线程池下会触发其 napi/wasm 边界问题，统一用进程池
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
