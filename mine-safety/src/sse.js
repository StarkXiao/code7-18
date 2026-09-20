/**
 * SSE 事件总线：调度大屏通过 EventSource 订阅，服务端单向推送。
 * 心跳用于穿透代理空闲超时，初始连接立即补发一份全量快照。
 */
export class SseHub {
  constructor() {
    /** @type {Set<import('node:http').ServerResponse>} */
    this.clients = new Set();
    this._seq = 0;
  }

  attach(res) {
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  push(event, data) {
    const id = (this._seq += 1);
    const chunk = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(chunk);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  heartbeat() {
    for (const res of this.clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        this.clients.delete(res);
      }
    }
  }

  get size() {
    return this.clients.size;
  }
}
