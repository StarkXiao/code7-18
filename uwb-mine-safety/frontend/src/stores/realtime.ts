import { defineStore } from 'pinia';
import type { Alarm, Broadcast } from '../api/types';

export interface LivePosition {
  tagId: string;
  name: string;
  team?: string | null;
  x: number;
  y: number;
  z: number;
  batteryPct?: number | null;
  t: number;
  sos?: boolean;
}

type WsState = 'connecting' | 'open' | 'closed';

interface RealtimeState {
  wsState: WsState;
  positions: Map<string, LivePosition>;
  latestAlarms: Alarm[];
  latestBroadcast: Broadcast | null;
  flashTagId: string | null;
}

export const useRealtimeStore = defineStore('realtime', {
  state: (): RealtimeState => ({
    wsState: 'closed',
    positions: new Map(),
    latestAlarms: [],
    latestBroadcast: null,
    flashTagId: null,
  }),
  getters: {
    positionList: (s) => [...s.positions.values()],
  },
  actions: {
    seedPositions(items: Array<{ tagId: string; name: string; team?: string | null; batteryPct?: number | null; lastPos?: { x: number; y: number; z: number } | null; lastSeenAt?: string | null }>) {
      for (const p of items) {
        if (p.lastPos) {
          this.positions.set(p.tagId, {
            tagId: p.tagId,
            name: p.name,
            team: p.team,
            x: p.lastPos.x,
            y: p.lastPos.y,
            z: p.lastPos.z,
            batteryPct: p.batteryPct,
            t: p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : Date.now(),
          });
        }
      }
    },
    connect() {
      if (this.wsState === 'open' || this.wsState === 'connecting') return;
      this.wsState = 'connecting';

      const base = import.meta.env.VITE_WS_BASE ?? '/ws';
      const url = new URL(base, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

      let ws: WebSocket;
      try {
        ws = new WebSocket(url.toString());
      } catch {
        this.wsState = 'closed';
        return;
      }

      ws.onopen = () => {
        this.wsState = 'open';
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as
            | { type: 'positions'; data: LivePosition[] }
            | { type: 'alarm'; data: Alarm }
            | { type: 'broadcast'; data: Broadcast }
            | { type: 'person'; data: { tagId: string; status: string } }
            | { type: 'stats'; data: unknown };
          this.handle(msg);
        } catch {
          // 忽略无法解析的帧
        }
      };
      ws.onclose = () => {
        this.wsState = 'closed';
        // 3 秒后自动重连
        setTimeout(() => this.connect(), 3000);
      };
      ws.onerror = () => ws.close();
    },
    handle(msg: { type: string; data: unknown }) {
      if (msg.type === 'positions') {
        for (const p of msg.data as LivePosition[]) {
          this.positions.set(p.tagId, p);
          if (p.sos) this.flashTagId = p.tagId;
        }
      } else if (msg.type === 'alarm') {
        const alarm = msg.data as Alarm;
        // 新告警插到最前；已解除的从顶部列表更新
        const idx = this.latestAlarms.findIndex((a) => a.id === alarm.id);
        if (idx >= 0) this.latestAlarms.splice(idx, 1, alarm);
        else this.latestAlarms.unshift(alarm);
        if (this.latestAlarms.length > 30) this.latestAlarms.length = 30;
      } else if (msg.type === 'broadcast') {
        this.latestBroadcast = msg.data as Broadcast;
      }
    },
  },
});
