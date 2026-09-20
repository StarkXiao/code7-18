import type { WebSocket } from 'ws';

/**
 * 实时推送中心。
 *
 * 事件类型：
 * - positions  批量位置更新（大屏人员移动）
 * - alarm      新告警/告警状态变化
 * - broadcast  广播下发记录
 * - stats      在线统计摘要
 *
 * 纯内存连接表：WebSocket 本来就是节点本地的，多实例部署时应在前面加
 * Redis pub/sub 或粘性会话；当前单实例足够矿调度室场景。
 */
export type RealtimeEvent =
  | { type: 'positions'; data: unknown[] }
  | { type: 'alarm'; data: unknown }
  | { type: 'broadcast'; data: unknown }
  | { type: 'stats'; data: unknown }
  | { type: 'person'; data: unknown };

class RealtimeHub {
  private readonly clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  broadcast(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export const realtimeHub = new RealtimeHub();
