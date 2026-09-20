import { describe, expect, it } from 'vitest';
import {
  TrackWindow,
  evaluateStationary,
  type TrackSample,
} from './stationary.js';

const RADIUS = 3;
const AFTER_SEC = 120;

function samplesFrom(points: Array<[number, number, number, number]>): TrackSample[] {
  return points.map(([x, y, z, t]) => ({ x, y, z, t: t * 1000 }));
}

describe('evaluateStationary', () => {
  it('持续静止超过阈值 → stationary=true，clusterStart 为首点', () => {
    const samples = samplesFrom([
      [10, 10, 0, 0],
      [10.2, 10.1, 0, 30],
      [9.8, 10.3, 0, 60],
      [10.1, 9.9, 0, 90],
      [10.0, 10.2, 0, 125],
    ]);
    const r = evaluateStationary(samples, 125_000, RADIUS, AFTER_SEC);
    expect(r.stationary).toBe(true);
    expect(r.clusterStart).toBe(0);
    expect(r.center).toBeTruthy();
  });

  it('一直在移动 → stationary=false', () => {
    const samples = samplesFrom([
      [10, 10, 0, 0],
      [20, 10, 0, 30],
      [30, 10, 0, 60],
      [40, 10, 0, 90],
      [50, 10, 0, 125],
    ]);
    const r = evaluateStationary(samples, 125_000, RADIUS, AFTER_SEC);
    expect(r.stationary).toBe(false);
    expect(r.clusterStart).toBeNull();
  });

  it('先移动后刚停下不满时长 → 不误报', () => {
    const samples = samplesFrom([
      [10, 10, 0, 0],
      [30, 10, 0, 40],
      [50, 10, 0, 80],
      [50.2, 10.1, 0, 100],
      [50.1, 9.9, 0, 120],
    ]);
    const r = evaluateStationary(samples, 120_000, RADIUS, AFTER_SEC);
    expect(r.stationary).toBe(false);
  });

  it('先移动、再在新位置静止满阈值 → 以新锚点检出', () => {
    const samples = samplesFrom([
      [10, 10, 0, 0],
      [60, 10, 0, 10],
      [60.2, 10.1, 0, 40],
      [59.9, 10.0, 0, 80],
      [60.1, 9.8, 0, 130],
      [60.0, 10.2, 0, 140],
    ]);
    const r = evaluateStationary(samples, 140_000, RADIUS, AFTER_SEC);
    expect(r.stationary).toBe(true);
    expect(r.clusterStart).toBe(10_000);
  });

  it('UWB 抖动（半径内）不应打断静止累计', () => {
    const samples: TrackSample[] = [];
    for (let i = 0; i <= 130; i += 5) {
      samples.push({
        x: 10 + (Math.random() - 0.5) * 1.0,
        y: 10 + (Math.random() - 0.5) * 1.0,
        z: 0,
        t: i * 1000,
      });
    }
    const r = evaluateStationary(samples, 130_000, RADIUS, AFTER_SEC);
    expect(r.stationary).toBe(true);
  });

  it('空样本', () => {
    expect(evaluateStationary([], 0, RADIUS, AFTER_SEC).stationary).toBe(false);
  });
});

describe('TrackWindow', () => {
  it('按人维护并自动清理窗口外样本', () => {
    const w = new TrackWindow();
    w.add('p1', { x: 0, y: 0, z: 0, t: 0 }, AFTER_SEC);
    w.add('p1', { x: 1, y: 0, z: 0, t: 60_000 });
    w.add('p1', { x: 2, y: 0, z: 0, t: 200_000 });
    const got = w.get('p1');
    expect(got.length).toBe(1);
    expect(got[0]!.t).toBe(200_000);
    expect(w.personIds()).toContain('p1');
    w.clear('p1');
    expect(w.get('p1')).toEqual([]);
  });
});
