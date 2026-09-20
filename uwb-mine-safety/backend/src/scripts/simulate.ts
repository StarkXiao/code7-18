/**
 * UWB 定位引擎模拟器。
 *
 * 以 1Hz 批量向 /api/v1/positions/ingest 推送人员坐标，并编排几个
 * 安全场景，方便不开真实硬件也能演示完整链路：
 *
 * - TAG-003 王大力：约第 20s 走进「中央变电所」，第 50s 离开（区域闯入 → 喊话 → 自动解除）
 * - TAG-007 孙立柱：约第 30s 起在「采空区边缘」附近静止不动（静止告警 → 升级）
 * - TAG-001 李矿生：约第 60s 按下 SOS
 * - TAG-012 蒋抽水：标签电量持续走低（低电量告警）
 * - 其余人员：沿主巷随机巡检
 *
 * 用法：npm run simulate（API 先启动；INGEST_KEY / API_BASE 可用环境变量覆盖）
 */
import 'dotenv/config';
import { env } from '../config/env.js';

const API_BASE = process.env.SIM_API_BASE ?? `${env.baseUrl}/api/v1`;
const INGEST_KEY = process.env.INGEST_KEY ?? 'uwb_dev_ingest_key_change_me_in_production_0001';

interface PersonSim {
  tagId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  battery: number;
  scenario?: 'substation' | 'stationary' | 'sos' | 'lowbatt';
}

const people: PersonSim[] = [
  { tagId: 'TAG-001', x: 80, y: 60, z: 0, vx: 1.2, vy: 0.1, battery: 78, scenario: 'sos' },
  { tagId: 'TAG-002', x: 120, y: 100, z: 0, vx: 0.6, vy: 0.4, battery: 64 },
  { tagId: 'TAG-003', x: 240, y: 120, z: 0, vx: 0, vy: 0, battery: 88, scenario: 'substation' },
  { tagId: 'TAG-004', x: 280, y: 140, z: 0, vx: 0.5, vy: 0, battery: 52 },
  { tagId: 'TAG-005', x: 200, y: 360, z: 0, vx: 0.3, vy: 0.2, battery: 90 },
  { tagId: 'TAG-006', x: 300, y: 360, z: 0, vx: -0.8, vy: 0, battery: 41 },
  { tagId: 'TAG-007', x: 560, y: 360, z: 0, vx: 0.9, vy: 0.2, battery: 73, scenario: 'stationary' },
  { tagId: 'TAG-008', x: 180, y: 380, z: 0, vx: 0.2, vy: -0.3, battery: 85 },
  { tagId: 'TAG-009', x: 420, y: 120, z: 0, vx: -0.4, vy: 0.1, battery: 67 },
  { tagId: 'TAG-010', x: 500, y: 340, z: 0, vx: 0.7, vy: 0.1, battery: 58 },
  { tagId: 'TAG-011', x: 340, y: 60, z: 0, vx: 0.5, vy: 0, battery: 71 },
  { tagId: 'TAG-012', x: 220, y: 60, z: 0, vx: 0.4, vy: 0, battery: 18, scenario: 'lowbatt' },
];

const TUNNEL = { minX: 30, maxX: 880, minY: 30, maxY: 460 };
const startedAt = Date.now();

function step(p: PersonSim, t: number): void {
  const jitter = () => (Math.random() - 0.5) * 0.2;

  switch (p.scenario) {
    case 'substation':
      // 0~20s 靠近变电所；20~50s 在变电所内徘徊；之后离开
      if (t < 20) {
        p.x += 4.5;
      } else if (t < 50) {
        p.x = 350 + Math.sin(t / 4) * 25;
        p.y = 120 + Math.cos(t / 5) * 15;
      } else {
        p.x -= 4.5;
        p.y = 120;
      }
      break;
    case 'stationary':
      // 走到采空区边缘外停下：30s 前移动，之后保持静止（仅 UWB 抖动）
      if (t < 30) {
        p.x += p.vx * 2;
        p.y += p.vy;
      } else {
        p.x += jitter() * 0.4;
        p.y += jitter() * 0.4;
      }
      break;
    default: {
      p.x += p.vx + jitter();
      p.y += p.vy + jitter();
      // 巷道边界折返
      if (p.x < TUNNEL.minX || p.x > TUNNEL.maxX) p.vx *= -1;
      if (p.y < TUNNEL.minY || p.y > TUNNEL.maxY) p.vy *= -1;
      p.x = Math.max(TUNNEL.minX, Math.min(TUNNEL.maxX, p.x));
      p.y = Math.max(TUNNEL.minY, Math.min(TUNNEL.maxY, p.y));
    }
  }

  if (p.scenario === 'lowbatt') p.battery = Math.max(5, p.battery - 0.05);
}

async function tick(t: number): Promise<void> {
  const positions = people.map((p) => {
    step(p, t);
    const sos = p.scenario === 'sos' && t === 60;
    return {
      tagId: p.tagId,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: p.z,
      batteryPct: Math.round(p.battery),
      measuredAt: Date.now(),
      sos,
    };
  });

  try {
    const res = await fetch(`${API_BASE}/positions/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ positions }),
    });
    const body = (await res.json()) as { accepted?: number; alarmsFired?: number; rejected?: unknown[] };
    console.log(
      `[${String(t).padStart(4)}s] HTTP ${res.status} accepted=${body.accepted ?? '-'} alarms=${body.alarmsFired ?? '-'}`,
    );
    if (body.rejected && body.rejected.length > 0) console.log('  rejected:', body.rejected);
  } catch (err) {
    console.error('推送失败（API 是否已启动？）:', err instanceof Error ? err.message : err);
  }
}

console.log(`UWB 定位模拟器启动 → ${API_BASE}`);
console.log('场景：TAG-003 闯变电所(20s) / TAG-007 采空区静止(30s) / TAG-001 SOS(60s) / TAG-012 低电量');
let t = 0;
void tick(t);
const timer = setInterval(() => {
  t++;
  void tick(t);
}, 1000);

process.on('SIGINT', () => {
  clearInterval(timer);
  const secs = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n模拟器结束，共运行 ${secs}s`);
  process.exit(0);
});
