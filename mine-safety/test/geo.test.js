import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInPolygon,
  zonesContaining,
  distPointToSegment,
  distanceToPolygon,
  isStationary,
} from '../src/geo.js';

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('pointInPolygon 射线法围栏判定', () => {
  it('判定多边形内外点', () => {
    assert.equal(pointInPolygon({ x: 5, y: 5 }, SQUARE), true);
    assert.equal(pointInPolygon({ x: -1, y: 5 }, SQUARE), false);
    assert.equal(pointInPolygon({ x: 11, y: 11 }, SQUARE), false);
  });

  it('边界与顶点按区域内处理（人员贴边不应漏警）', () => {
    assert.equal(pointInPolygon({ x: 0, y: 5 }, SQUARE), true);
    assert.equal(pointInPolygon({ x: 10, y: 0 }, SQUARE), true);
  });

  it('支持凹多边形', () => {
    // C 形凹多边形：凹口朝右
    const concave = [
      [0, 0],
      [10, 0],
      [10, 3],
      [3, 3],
      [3, 7],
      [10, 7],
      [10, 10],
      [0, 10],
    ];
    assert.equal(pointInPolygon({ x: 1, y: 5 }, concave), true);
    assert.equal(pointInPolygon({ x: 6, y: 5 }, concave), false);
    assert.equal(pointInPolygon({ x: 6, y: 1 }, concave), true);
  });
});

describe('zonesContaining', () => {
  const zones = [
    { id: 'a', polygon: SQUARE },
    { id: 'b', polygon: [[20, 20], [30, 20], [30, 30], [20, 30]] },
  ];
  it('只返回包含该点的区域', () => {
    assert.deepEqual(zonesContaining({ x: 5, y: 5 }, zones), ['a']);
    assert.deepEqual(zonesContaining({ x: 25, y: 25 }, zones), ['b']);
    assert.deepEqual(zonesContaining({ x: 100, y: 100 }, zones), []);
  });
});

describe('距离计算', () => {
  it('点到线段的垂足距离与端点距离', () => {
    assert.equal(distPointToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
    assert.equal(distPointToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 10 }), 3);
  });

  it('到矩形边界的最近距离', () => {
    assert.equal(distanceToPolygon({ x: 12, y: 5 }, SQUARE), 2);
    assert.equal(distanceToPolygon({ x: 10, y: 5 }, SQUARE), 0);
    assert.equal(distanceToPolygon({ x: 5, y: 5 }, SQUARE), 5);
  });
});

describe('isStationary', () => {
  it('位移范围小于阈值视为静止', () => {
    const samples = [
      { x: 10, y: 10 },
      { x: 10.4, y: 9.8 },
      { x: 10.1, y: 10.2 },
    ];
    assert.equal(isStationary(samples, 1.5), true);
  });

  it('发生实质位移后判为移动', () => {
    const samples = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
    ];
    assert.equal(isStationary(samples, 1.5), false);
  });

  it('单点无法判定', () => {
    assert.equal(isStationary([{ x: 1, y: 1 }], 1.5), false);
  });
});
