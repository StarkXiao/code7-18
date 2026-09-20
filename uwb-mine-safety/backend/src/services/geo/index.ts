/** 二维点（矿井局部坐标系，单位：米） */
export interface Point {
  x: number;
  y: number;
}

/** 多边形区域顶点，首尾无需重合 */
export type Polygon = Point[];

/**
 * 射线法判断点是否在多边形内部（含边界判定）。
 * 边界点返回 true——对于电子围栏，"压线"应按进入处理，不能漏报。
 */
export function pointInPolygon(p: Point, polygon: Polygon): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = polygon[i]!;
    const vj = polygon[j]!;

    // 边界判定：点在线段上
    if (pointOnSegment(p, vj, vi)) return true;

    const intersects =
      vi.y > p.y !== vj.y > p.y &&
      p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  if (cross(a, b, p) !== 0) return false;
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** 平面欧氏距离（米） */
export function distance2D(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 三维距离：z 通常表示水平（米）。UWB 提供三维坐标时用它做静止判定，
 * 人员在斜坡/竖井内垂直移动也算"动了"。
 */
export function distance3D(
  a: Point & { z: number },
  b: Point & { z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 取点集中的中心点（多边形标签/弹窗定位用） */
export function centroid(polygon: Polygon): Point {
  if (polygon.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of polygon) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / polygon.length, y: sy / polygon.length };
}

/** 粗略边界框，前端定位缩放用 */
export function bounds(polygon: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
