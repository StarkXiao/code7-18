import { distance3D } from '../geo/index.js';

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** 采样时刻（毫秒） */
  t: number;
}

/**
 * 静止判定核心算法。
 *
 * 不是简单比较"最新点和上一个点"——UWB 有 0.1~0.5m 的抖动，两点比较会
 * 在静止时频繁误报。正确做法是维护一个"锚点簇"：
 *
 * 1. 新点与簇中心距离超过 radiusM → 人确实移动了，清空并重建簇；
 * 2. 否则并入簇中；
 * 3. 簇持续时间（首个样本到现在）≥ afterSec → 判定静止。
 *
 * 返回簇中心（静止时可代表人员位置）。
 */
export interface StationaryResult {
  stationary: boolean;
  clusterStart: number | null;
  center: { x: number; y: number; z: number } | null;
}

export function evaluateStationary(
  samples: TrackSample[],
  now: number,
  radiusM: number,
  afterSec: number,
): StationaryResult {
  if (samples.length === 0) {
    return { stationary: false, clusterStart: null, center: null };
  }

  // 单遍扫描，维护"延续到最新点的锚点簇"：遇到超出半径的点就以该点重建簇。
  // 移动途中可能多次重建，只有最终延续到最新点的簇有意义——人已经走掉的
  // 历史静止段不该触发告警。
  let anchor = samples[0]!;
  let count = 1;
  let sx = anchor.x;
  let sy = anchor.y;
  let sz = anchor.z;

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    if (distance3D(s, anchor) > radiusM) {
      anchor = s;
      count = 1;
      sx = s.x;
      sy = s.y;
      sz = s.z;
    } else {
      count++;
      sx += s.x;
      sy += s.y;
      sz += s.z;
    }
  }

  const durationMs = now - anchor.t;
  const stationary = durationMs >= afterSec * 1000;
  return {
    stationary,
    clusterStart: stationary ? anchor.t : null,
    center: { x: sx / count, y: sy / count, z: sz / count },
  };
}

/**
 * 滑动样本缓存：按人保留最近 windowSec 的原始点。
 * 进程重启会丢失静止历史——这是可接受的：重启后最坏 afterSec 秒重新检出。
 */
export class TrackWindow {
  private readonly samples = new Map<string, TrackSample[]>();

  add(personId: string, sample: TrackSample, windowSec = 120): void {
    let list = this.samples.get(personId);
    if (!list) {
      list = [];
      this.samples.set(personId, list);
    }
    list.push(sample);
    const cutoff = sample.t - (windowSec + 5) * 1000;
    // 丢弃窗口外样本（顺手压缩，避免 Map 无限增长）
    while (list.length > 0 && list[0]!.t < cutoff) list.shift();
  }

  get(personId: string): TrackSample[] {
    return this.samples.get(personId) ?? [];
  }

  clear(personId: string): void {
    this.samples.delete(personId);
  }

  personIds(): string[] {
    return [...this.samples.keys()];
  }
}
