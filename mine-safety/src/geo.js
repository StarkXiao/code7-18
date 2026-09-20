/**
 * 几何工具：井下坐标采用 UWB 引擎输出的局部平面直角坐标系（单位：米）。
 * 危险区域为多边形，使用射线法判定人员是否在区域内。
 */

/**
 * 点是否在多边形内（ray casting，支持凹多边形，边界点按在内处理）。
 * @param {{x:number,y:number}} p
 * @param {Array<[number,number]>} polygon 首尾不重合的顶点环
 */
export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    // 恰好落在边上（含端点），视为区域内
    if (distPointToSegment(p, { x: xi, y: yi }, { x: xj, y: yj }) < 1e-9) {
      return true;
    }
  }
  return inside;
}

export function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 找出人员当前所在的全部区域（区域允许重叠，返回区域 id 列表）。
 * @param {{x:number,y:number}} point
 * @param {Array<{id:string,polygon:Array<[number,number]>}>} zones
 */
export function zonesContaining(point, zones) {
  return zones.filter((z) => pointInPolygon(point, z.polygon)).map((z) => z.id);
}

/** 到多边形边界的最近距离（用于大屏显示"距危险区边界 N 米"）。 */
export function distanceToPolygon(point, polygon) {
  let min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const d = distPointToSegment(
      point,
      { x: polygon[j][0], y: polygon[j][1] },
      { x: polygon[i][0], y: polygon[i][1] },
    );
    if (d < min) min = d;
  }
  return min;
}

/**
 * 最近位置语义标签：优先区域名，否则取最近巷道（折线）及其近似里程。
 * @returns {{zone?:string, track?:string, offsetM:number}}
 */
export function locationLabel(point, zones, tracks) {
  const hit = zones.find((z) => pointInPolygon(point, z.polygon));
  if (hit) return { zone: hit.name, offsetM: 0 };

  let best = null;
  for (const track of tracks) {
    let acc = 0;
    for (let i = 1; i < track.path.length; i++) {
      const a = { x: track.path[i - 1][0], y: track.path[i - 1][1] };
      const b = { x: track.path[i][0], y: track.path[i][1] };
      const d = distPointToSegment(point, a, b);
      if (!best || d < best.offsetM) {
        best = { track: track.name, offsetM: Math.round(d * 10) / 10, mileage: acc };
      }
      acc += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return best ?? { offsetM: NaN };
}

/** 计算人员是否"基本静止"：时间窗内位置包围盒对角线小于阈值半径的 2 倍。 */
export function isStationary(samples, radiusM) {
  if (samples.length < 2) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  return Math.hypot(maxX - minX, maxY - minY) <= radiusM * 2;
}
