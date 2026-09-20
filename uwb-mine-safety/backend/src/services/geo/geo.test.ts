import { describe, expect, it } from 'vitest';
import { bounds, centroid, distance2D, distance3D, pointInPolygon } from './index.js';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const triangle = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 10 },
];

describe('pointInPolygon', () => {
  it('识别内部点', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 3 }, triangle)).toBe(true);
  });

  it('识别外部点', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 1, y: 9 }, triangle)).toBe(false);
  });

  it('边界点（含顶点）视为内部——围栏不能漏报', () => {
    expect(pointInPolygon({ x: 10, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 0 }, triangle)).toBe(true);
  });

  it('凹多边形：海湾处应为外部', () => {
    // C 形凹多边形
    const concave = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 6 }, concave)).toBe(false);
    expect(pointInPolygon({ x: 1.5, y: 5 }, concave)).toBe(true);
    expect(pointInPolygon({ x: 8.5, y: 5 }, concave)).toBe(true);
  });

  it('少于 3 个顶点直接返回 false', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('distance helpers', () => {
  it('2D 距离', () => {
    expect(distance2D({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 10);
  });
  it('3D 距离计入垂直移动', () => {
    expect(distance3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })).toBeCloseTo(5, 10);
  });
  it('centroid 与 bounds', () => {
    expect(centroid(square)).toEqual({ x: 5, y: 5 });
    expect(bounds(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});
