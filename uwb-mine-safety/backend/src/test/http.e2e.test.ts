import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { setupIntegrationDb } from './integration-db.js';
import { _resetRuleStateForTest, refreshZoneCache } from '../services/ingest/pipeline.js';

setupIntegrationDb();

let server: Server;
let base: string;
const INGEST_KEY = 'uwb_test_http_key';

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: await bcrypt.hash('pass1234', 4),
      displayName: '管理员',
      role: 'admin',
    },
  });
  await prisma.user.create({
    data: {
      username: 'ro',
      passwordHash: await bcrypt.hash('pass1234', 4),
      displayName: '只读',
      role: 'viewer',
    },
  });
  await prisma.ingestKey.create({ data: { key: INGEST_KEY, name: 'test' } });
  await prisma.zone.create({
    data: {
      code: 'Z-HTTP',
      name: 'HTTP 禁区',
      level: 'restricted',
      floor: 0,
      polygon: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ] as never,
    },
  });
  await prisma.person.create({ data: { tagId: 'TAG-H', name: 'HTTP 员', team: '测试队' } });
  await refreshZoneCache(true);
  _resetRuleStateForTest();

  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('bad listen address');
  base = `http://127.0.0.1:${addr.port}/api/v1`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function api(path: string, opts: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string>) } });
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body };
}

describe('HTTP 端到端', () => {
  it('错误密码 → 401', async () => {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
    expect(r.status).toBe(401);
  });

  it('登录 → 拿 token → /auth/me 可用', async () => {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'pass1234' }) });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();

    const me = await api('/auth/me', { token: r.body.accessToken });
    expect(me.body.user.role).toBe('admin');
  });

  it('无 token 访问受保护接口 → 401', async () => {
    const r = await api('/persons');
    expect(r.status).toBe(401);
  });

  it('参数校验失败 → 422 且带字段级 details', async () => {
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'pass1234' }) });
    const r = await api('/zones', {
      method: 'POST',
      token: login.body.accessToken,
      body: JSON.stringify({ code: 'X', name: '坏围栏', level: 'restricted', polygon: [{ x: 1, y: 1 }] }),
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation_error');
  });

  it('viewer 不能建围栏（RBAC → 403）', async () => {
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ro', password: 'pass1234' }) });
    const r = await api('/zones', {
      method: 'POST',
      token: login.body.accessToken,
      body: JSON.stringify({ code: 'X2', name: '越权', level: 'safe', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }),
    });
    expect(r.status).toBe(403);
  });

  it('设备接入：无 key → 401；正确 key 推送闯入坐标 → 告警产生', async () => {
    const noKey = await api('/positions/ingest', {
      method: 'POST',
      body: JSON.stringify({ positions: [{ tagId: 'TAG-H', x: 10, y: 10, z: 0 }] }),
    });
    expect(noKey.status).toBe(401);

    const ok = await fetch(base + '/positions/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ positions: [{ tagId: 'TAG-H', x: 10, y: 10, z: 0 }] }),
    });
    const body: any = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.accepted).toBe(1);
    expect(body.alarmsFired).toBe(1);
  });

  it('未登记标签 → rejected 中说明原因', async () => {
    const res = await fetch(base + '/positions/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ positions: [{ tagId: 'GHOST', x: 0, y: 0, z: 0 }] }),
    });
    const body: any = await res.json();
    expect(body.accepted).toBe(0);
    expect(body.rejected[0].tagId).toBe('GHOST');
  });

  it('调度台能看到刚产生的未决告警，统计 open-count 一致', async () => {
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'pass1234' }) });
    const token = login.body.accessToken;

    const list = await api('/alarms?status=active', { token });
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const intrusion = list.body.items.find((a: { type: string }) => a.type === 'zone_intrusion');
    expect(intrusion.person.name).toBe('HTTP 员');
    expect(intrusion.zone.name).toBe('HTTP 禁区');

    const count = await api('/alarms/open-count', { token });
    expect(count.body.open).toBeGreaterThanOrEqual(1);

    // 确认 → 再解除，走完处置闭环
    const ack = await api(`/alarms/${intrusion.id}/ack`, { method: 'POST', token });
    expect(ack.body.status).toBe('acked');
    const resolve = await api(`/alarms/${intrusion.id}/resolve`, {
      method: 'POST',
      token,
      body: JSON.stringify({ note: 'HTTP 测试处置完毕' }),
    });
    expect(resolve.body.status).toBe('resolved');
  });

  it('联动广播已落库且内容正确', async () => {
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'pass1234' }) });
    const list = await api('/broadcasts?pageSize=50', { token: login.body.accessToken });
    const auto = list.body.items.find((b: { triggerType: string }) => b.triggerType === 'auto');
    expect(auto).toBeTruthy();
    expect(auto.status).toBe('sent');
    expect(auto.content).toContain('HTTP 员');
  });
});
