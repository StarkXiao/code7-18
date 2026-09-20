/**
 * UWB 定位引擎接入。
 * 协议（JSON over UDP，每行一个数据报，字段命名与主流 UWB 定位引擎 HTTP 推送对齐）：
 *   {"tagId":"T001","x":12.4,"y":88.1,"z":0.0,"ts":1716000000000}
 * 也兼容批量：{"positions":[{...},{...}]}
 *
 * 坐标必须是引擎换算后的局部平面坐标（米）；锚点原始测距解算在定位引擎侧完成。
 * UDP 只管尽力接收：坏报文计入统计并丢弃，绝不能因为单条脏数据影响监控循环。
 */
import dgram from 'node:dgram';

export class UwbIngest {
  /**
   * @param {import('./store.js').PositionStore} store
   */
  constructor(store, { port }) {
    this.store = store;
    this.port = port;
    this.socket = null;
    this.stats = {
      datagrams: 0,
      positions: 0,
      badDatagrams: 0,
      lastSource: null,
      lastAt: null,
    };
  }

  start() {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg, rinfo) => {
      this.stats.datagrams += 1;
      this.stats.lastSource = `${rinfo.address}:${rinfo.port}`;
      this.stats.lastAt = Date.now();
      let parsed;
      try {
        parsed = JSON.parse(msg.toString('utf8'));
      } catch {
        this.stats.badDatagrams += 1;
        return;
      }
      const list = Array.isArray(parsed?.positions) ? parsed.positions : [parsed];
      for (const item of list) {
        try {
          this.store.ingestPosition(item);
          this.stats.positions += 1;
        } catch {
          this.stats.badDatagrams += 1;
        }
      }
    });
    this.socket.on('error', (err) => {
      console.error(`[uwb] UDP socket 错误: ${err.message}`);
    });
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.port, () => {
        console.log(`[uwb] 正在 UDP ${this.port} 接收 UWB 定位数据`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.socket) return resolve();
      this.socket.close(() => resolve());
    });
  }
}
