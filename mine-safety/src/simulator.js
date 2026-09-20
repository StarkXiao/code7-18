/**
 * UWB 标签模拟源：替代真实定位引擎，按固定节奏向 PositionStore 喂定位数据，
 * 并叠加高斯噪声模拟 UWB 测量抖动（让静止判定面对真实噪声仍可靠）。
 *
 * 演示场景：
 *   normal     所有人员沿各自巷道正常巡走
 *   intrusion  T002 从西翼联巷闯入 1101 采空区
 *   still      T004 在东翼轨道上山停止移动
 */

// 每条线路是若干路径点，模拟人员沿折线往返巡逻
const ROUTES = {
  T001: [
    [0, 120], [40, 120], [80, 115], [130, 100], [170, 95], [220, 95], [260, 100],
  ],
  T002: [
    [30, 119], [60, 118], [80, 115], [75, 95], [40, 100], [20, 110],
  ],
  T003: [
    [170, 95], [200, 92], [220, 95], [240, 70], [258, 52], [266, 40],
  ],
  T004: [
    [170, 95], [167, 78], [164, 66], [161, 58],
  ],
  T005: [
    [80, 115], [100, 108], [115, 105], [130, 100], [105, 112],
  ],
  T006: [
    [232, 100], [245, 104], [262, 102], [262, 108], [240, 110],
  ],
  T007: [
    [0, 120], [50, 119], [110, 108], [180, 96], [240, 98], [260, 100],
  ],
  T008: [
    [40, 120], [80, 115], [130, 100], [170, 95], [200, 92],
  ],
  T009: [
    [200, 92], [220, 95], [240, 70], [258, 52], [230, 80],
  ],
};

// 闯入路径：从西翼联巷进入采空区内部停留后再撤出
const INTRUSION_ROUTE = [
  [80, 115], [70, 135], [55, 150], [60, 168], [80, 170],
];

function gaussianNoise(sigma) {
  // Box–Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Simulator {
  /**
   * @param {import('./store.js').PositionStore} store
   */
  constructor(store, cfg) {
    this.store = store;
    this.cfg = cfg;
    this.running = false;
    this.timer = null;
    this.scenario = 'normal';
    this._states = new Map();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
    console.log(`[sim] 模拟定位源已启动，场景：${this.scenario}，上报周期 ${this.cfg.reportIntervalMs}ms`);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  setScenario(name) {
    if (!['normal', 'intrusion', 'still'].includes(name)) {
      throw new Error(`未知场景: ${name}`);
    }
    this.scenario = name;
    // 场景切换时让闯入人员从采空区外重新起步
    this._states.delete('T002');
    this._states.delete('T004');
    console.log(`[sim] 场景切换 -> ${name}`);
    return this.scenario;
  }

  /** 直接把某标签钉在某个坐标（接口演练用），返回其当前状态 */
  forcePosition(tagId, x, y) {
    this.store.ingestPosition({ tagId, x, y, ts: Date.now() });
    return this.store.getTag(tagId);
  }

  _loop = () => {
    if (!this.running) return;
    try {
      this._tick(Date.now());
    } catch (err) {
      console.error(`[sim] 模拟周期异常: ${err.message}`);
    }
    this.timer = setTimeout(this._loop, this.cfg.reportIntervalMs);
  };

  _tick(now) {
    const dt = this.cfg.reportIntervalMs / 1000;
    for (const tag of this.store.listTags()) {
      if (tag.unknown) continue; // 外部注入的陌生标签不由模拟源驱动
      let state = this._states.get(tag.tagId);
      if (!state) {
        const route = tag.tagId === 'T002' && this.scenario === 'intrusion'
          ? INTRUSION_ROUTE
          : ROUTES[tag.tagId] || ROUTES.T001;
        state = {
          route,
          seg: 0,
          x: route[0][0],
          y: route[0][1],
          dir: 1,
          speed: 0.8 + Math.random() * 0.7, // 0.8–1.5 m/s 步行速度
        };
        this._states.set(tag.tagId, state);
      }

      // 静止场景：T004 到位后不再推进
      const frozen = this.scenario === 'still' && tag.tagId === 'T004' && state.seg >= 2;
      if (!frozen) this._advance(state, dt);

      // 闯入场景 T002 到达采空区深处后停在原地（触发区域内静止高危告警，随后手动撤离）
      const hold =
        this.scenario === 'intrusion' &&
        tag.tagId === 'T002' &&
        state.seg >= state.route.length - 1;

      if (!hold) {
        const nx = state.x + gaussianNoise(this.cfg.noiseM);
        const ny = state.y + gaussianNoise(this.cfg.noiseM);
        this.store.ingestPosition({ tagId: tag.tagId, x: nx, y: ny, ts: now });
      }
      // hold 时不喂数据外的坐标，但仍持续上报"原地+噪声"，模拟人员停留（不是标签离线）
      else {
        this.store.ingestPosition({
          tagId: tag.tagId,
          x: state.x + gaussianNoise(this.cfg.noiseM),
          y: state.y + gaussianNoise(this.cfg.noiseM),
          ts: now,
        });
      }
    }
  }

  /** 沿当前线段推进 dt 秒，到端点后折返 */
  _advance(state, dt) {
    let remaining = state.speed * dt;
    let guard = 0;
    while (remaining > 0 && guard < 32) {
      guard += 1;
      const target = state.route[state.seg + state.dir];
      if (!target) {
        state.dir *= -1;
        continue;
      }
      const dx = target[0] - state.x;
      const dy = target[1] - state.y;
      const len = Math.hypot(dx, dy);
      if (len <= remaining) {
        state.x = target[0];
        state.y = target[1];
        state.seg += state.dir;
        remaining -= len;
        if (state.seg <= 0 || state.seg >= state.route.length - 1) {
          state.dir *= -1;
        }
      } else {
        state.x += (dx / len) * remaining;
        state.y += (dy / len) * remaining;
        remaining = 0;
      }
    }
  }
}
