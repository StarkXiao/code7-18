#!/usr/bin/env node
/**
 * 系统入口：HTTP API + 静态大屏 + UWB UDP 接入 + 检测主循环。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from './config.js';
import { PositionStore } from './store.js';
import { DetectionEngine } from './detection.js';
import { Broadcaster } from './broadcaster.js';
import { UwbIngest } from './uwb.js';
import { Simulator } from './simulator.js';
import { SseHub } from './sse.js';
import { buildSnapshot, publicAlarm } from './snapshot.js';
import { defaultTracks, defaultZones, defaultWorkers } from './defaults.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');

// ── 组件装配 ────────────────────────────────────────────────────────────────
const store = new PositionStore({
  zones: defaultZones,
  tracks: defaultTracks,
  workers: defaultWorkers,
  dataFile: config.dataFile,
  historyLimit: config.alarm.historyLimit,
});

const broadcaster = new Broadcaster(config.broadcast);
const hub = new SseHub();
broadcaster.ssePush = (event, data) => hub.push(event, data);

// 检测参数（含告警重复广播节奏）集中成一份传给引擎
const detectionCfg = {
  ...config.detection,
  repeatIntervalSec: config.alarm.repeatIntervalSec,
};
const engine = new DetectionEngine(store, broadcaster, detectionCfg);
const uwb = config.uwb.enabled ? new UwbIngest(store, { port: config.uwb.port }) : null;
const sim = config.simulator.enabled ? new Simulator(store, config.simulator) : null;

// ── HTTP 工具 ───────────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(raw);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

// ── API 路由 ─────────────────────────────────────────────────────────────────
const routes = {
  'GET /api/state': (_req, res) => sendJson(res, 200, buildSnapshot(store, { sim, uwb, hub, detectionCfg })),

  'GET /api/events': (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    hub.attach(res);
    // 连接建立立即补发快照，之后由检测循环驱动增量推送
    res.write(`event: snapshot\ndata: ${JSON.stringify(buildSnapshot(store, { sim, uwb, hub, detectionCfg }))}\n\n`);
  },

  // 模拟引擎 HTTP 接入（生产环境由 UWB 引擎走 UDP，无需此接口）
  'POST /api/positions': async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: '请求体不是合法 JSON' });
    }
    const list = Array.isArray(body.positions) ? body.positions : [body];
    const accepted = [];
    for (const p of list) {
      try {
        store.ingestPosition(p);
        accepted.push(p.tagId);
      } catch (err) {
        return sendJson(res, 422, { error: err.message, bad: p });
      }
    }
    sendJson(res, 202, { accepted: accepted.length, tagIds: accepted });
  },

  'POST /api/sim/scenario': async (req, res) => {
    if (!sim) return sendJson(res, 400, { error: '模拟源未启用（SIMULATOR_ENABLED=false）' });
    const body = await readJson(req).catch(() => ({}));
    try {
      const scenario = sim.setScenario(body.scenario);
      hub.push('simulator', { scenario });
      sendJson(res, 200, { scenario });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  },

  'POST /api/sim/force': async (req, res) => {
    const body = await readJson(req).catch(() => null);
    if (!body?.tagId || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      return sendJson(res, 400, { error: '需要 tagId 与数值型 x/y' });
    }
    const tag = sim?.forcePosition(body.tagId, body.x, body.y) ?? store.ingestPosition(body);
    sendJson(res, 200, { tagId: tag.tagId, x: tag.x, y: tag.y });
  },

  'POST /api/alarms/ack': async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const alarm = store.alarms.find((a) => a.id === body.alarmId);
    if (!alarm) return sendJson(res, 404, { error: '告警不存在' });
    if (alarm.status !== 'active') return sendJson(res, 409, { error: '该告警已结束，无需确认' });
    store.updateAlarm(alarm, { ackedAt: Date.now(), ackedBy: body.operator || '调度员' });
    const data = publicAlarm(alarm);
    hub.push('alarm.updated', data);
    sendJson(res, 200, data);
  },

  'POST /api/alarms/clear': async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const alarm = store.alarms.find((a) => a.id === body.alarmId);
    if (!alarm) return sendJson(res, 404, { error: '告警不存在' });
    if (alarm.status !== 'active') return sendJson(res, 409, { error: '该告警已结束' });
    store.updateAlarm(alarm, {
      status: 'resolved',
      resolvedAt: Date.now(),
      resolveReason: body.reason || '调度员人工解除',
      clearedBy: body.operator || '调度员',
    });
    const data = publicAlarm(alarm);
    hub.push('alarm.resolved', data);
    sendJson(res, 200, data);
  },

  'PATCH /api/zones/:id': async (req, res, params) => {
    const body = await readJson(req).catch(() => ({}));
    const zone = store.getZone(params.id);
    if (!zone) return sendJson(res, 404, { error: '区域不存在' });
    if (typeof body.enabled === 'boolean') {
      store.setZoneEnabled(zone.id, body.enabled);
      hub.push('zones.updated', store.zones);
    }
    sendJson(res, 200, zone);
  },

  'GET /readyz': (_req, res) => sendJson(res, 200, { ok: true, ts: Date.now() }),
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (handler) return handler(req, res, {});
    const zoneMatch = url.pathname.match(/^\/api\/zones\/([\w-]+)$/);
    if (req.method === 'PATCH' && zoneMatch) {
      return routes['PATCH /api/zones/:id'](req, res, { id: zoneMatch[1] });
    }
    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: '接口不存在' });
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error(`[http] 未处理异常: ${err.stack || err.message}`);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
  }
});

// ── 检测主循环 ────────────────────────────────────────────────────────────────
async function runDetectionCycle() {
  const now = Date.now();
  try {
    const events = await engine.tick(now);
    for (const { event, data } of events) hub.push(event, data);
    // 每个周期推送一次轻量快照（位置与倒计时在大屏上持续刷新）
    hub.push('tick', buildSnapshot(store, { sim, uwb, hub, detectionCfg }));
  } catch (err) {
    console.error(`[loop] 检测周期异常: ${err.stack || err.message}`);
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
async function main() {
  if (uwb) {
    try {
      await uwb.start();
    } catch (err) {
      console.error(`[uwb] 启动失败，继续以无 UDP 模式运行: ${err.message}`);
    }
  }
  if (sim) sim.start();

  const loopTimer = setInterval(runDetectionCycle, config.detection.intervalMs);
  loopTimer.unref?.();
  const sseTimer = setInterval(() => hub.heartbeat(), 15000);
  sseTimer.unref?.();

  server.listen(config.httpPort, () => {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  井下人员定位安全系统  Mine Personnel Positioning Safety');
    console.log(`  调度大屏:  http://localhost:${config.httpPort}/`);
    console.log(`  状态接口:  http://localhost:${config.httpPort}/api/state`);
    if (uwb) console.log(`  UWB 接入:  UDP :${config.uwb.port}  (JSON 数据报)`);
    if (sim) console.log(`  模拟源:    已开启 (场景 ${sim.scenario})`);
    console.log(`  静止阈值:  ${config.detection.stationaryThresholdSec}s ｜ 离线阈值: ${config.detection.offlineThresholdSec}s`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
  });

  const shutdown = (signal) => {
    console.log(`\n收到 ${signal}，正在保存数据并退出…`);
    clearInterval(loopTimer);
    clearInterval(sseTimer);
    sim?.stop();
    uwb?.stop();
    try {
      store.persist();
    } catch (err) {
      console.error(`退出时保存失败: ${err.message}`);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
