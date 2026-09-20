import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeAnnouncement } from '../src/broadcaster.js';

describe('composeAnnouncement 广播话术', () => {
  const worker = { name: '王海涛' };
  const zone = { name: '1101 采空区' };

  it('首次闯入广播包含人员、区域与撤离指令', () => {
    const text = composeAnnouncement(
      { type: 'zone_entry', message: '严禁进入', dwellSec: 0 },
      { zoneName: zone.name, workerName: worker.name },
      false,
    );
    assert.match(text, /王海涛/);
    assert.match(text, /1101 采空区/);
    assert.match(text, /请注意/);
    assert.match(text, /撤离/);
  });

  it('重复广播使用"再次提醒"', () => {
    const text = composeAnnouncement(
      { type: 'zone_entry', message: '立即撤离' },
      { zoneName: zone.name, workerName: worker.name },
      true,
    );
    assert.match(text, /再次提醒/);
  });

  it('静止告警包含静止时长与前往查看的处置指令', () => {
    const text = composeAnnouncement(
      { type: 'stationary', dwellSec: 33 },
      { zoneName: '东翼轨道上山', workerName: '刘强' },
      false,
    );
    assert.match(text, /刘强/);
    assert.match(text, /已静止33秒/);
    assert.match(text, /前往查看/);
  });

  it('离线告警为调度通报口吻、包含搜寻指令', () => {
    const text = composeAnnouncement(
      { type: 'offline', offlineSec: 17 },
      { zoneName: '主运输大巷', workerName: '孙建军' },
      false,
    );
    assert.match(text, /调度通报/);
    assert.match(text, /孙建军/);
    assert.match(text, /信号丢失17秒/);
    assert.match(text, /搜寻/);
  });
});
