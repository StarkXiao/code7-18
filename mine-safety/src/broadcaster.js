/**
 * 应急广播联动。
 * 渠道：
 *  - console : 服务端声光控制台模拟（生产环境对应井下 IP 广播主机的 SDK / CGI 调用）
 *  - sse     : 推送前端调度大屏，触发语音播报（Web Speech）与警笛
 *  - webhook : 第三方调度平台 / 综合自动化系统，超时重试、失败降级不影响告警主流程
 * 重复广播由 AlarmManager 按节奏调用，本模块只负责"把一次广播可靠发出去"。
 */

const REPEAT_WORD = { first: '请注意', repeat: '再次提醒' };

export function composeAnnouncement(alarm, { zoneName, workerName }, repeat) {
  const when = repeat ? REPEAT_WORD.repeat : REPEAT_WORD.first;
  if (alarm.type === 'zone_entry') {
    return `${when}！${workerName}已进入${zoneName}危险区域，${
      alarm.message || '请立即撤离'
    }。现场人员请立即撤离，调度员请立即处置。`;
  }
  if (alarm.type === 'stationary') {
    return `${when}！${workerName}在${zoneName}已静止${alarm.dwellSec || 0}秒，可能发生晕倒或受伤，请附近人员立即前往查看，调度员立即呼叫确认。`;
  }
  if (alarm.type === 'offline') {
    const place = zoneName && zoneName !== '最后已知位置' ? `最后位置${zoneName}附近，` : '';
    return `调度通报：${workerName}定位信号丢失${alarm.offlineSec || 0}秒，${place}请立即安排搜寻并核实人员安全。`;
  }
  return `${when}！井下发生人员安全告警，请相关人员立即处置。`;
}

export class Broadcaster {
  constructor({ channels = ['console', 'sse'], webhookUrl, webhookTimeoutMs = 3000, webhookRetries = 2 } = {}) {
    this.channels = new Set(channels);
    this.webhookUrl = webhookUrl;
    this.webhookTimeoutMs = webhookTimeoutMs;
    this.webhookRetries = webhookRetries;
    /** @type {(event:string,data:unknown)=>void} 由 server 注入的 SSE 推送 */
    this.ssePush = null;
  }

  /**
   * 发送一次广播。
   * @returns {Promise<{channels:string[], webhook?:{status:string, attempts:number, error?:string}}>}
   */
  async send(alarm, worker, zone, { repeat = false } = {}) {
    const announcement = composeAnnouncement(alarm, {
      zoneName: zone?.name || alarm.zoneName || '未知区域',
      workerName: worker?.name || alarm.tagId,
    }, repeat);

    const payload = {
      broadcastId: `BC${Date.now()}${String(Math.random()).slice(2, 6)}`,
      alarmId: alarm.id,
      level: alarm.level,
      type: alarm.type,
      tagId: alarm.tagId,
      workerName: worker?.name || alarm.tagId,
      zoneName: zone?.name || alarm.zoneName || null,
      text: announcement,
      repeat,
      sentAt: new Date().toISOString(),
      channels: [...this.channels],
    };

    if (this.channels.has('console')) this._consoleSend(payload, alarm);
    if (this.channels.has('sse') && this.ssePush) {
      this.ssePush('broadcast', payload);
    }

    if (this.channels.has('webhook') && this.webhookUrl) {
      payload.webhook = await this._postWebhook(alarm, announcement);
    }

    return payload;
  }

  _consoleSend(payload, alarm) {
    const icon = alarm.level === 'danger' ? '🚨' : '📢';
    const line = '─'.repeat(24);
    console.log(
      [
        '',
        `${line} 应急广播 ${line}`,
        `${icon} [${alarm.level === 'danger' ? '高危' : '警告'}] ${payload.text}`,
        `   标签 ${payload.tagId}｜告警 ${payload.alarmId}｜${payload.repeat ? '重复广播' : '首次广播'}｜${payload.sentAt}`,
        `${'─'.repeat(52)}`,
      ].join('\n'),
    );
  }

  async _postWebhook(alarm, text) {
    const body = JSON.stringify({
      event: 'mine_safety_broadcast',
      alarmId: alarm.id,
      level: alarm.level,
      tagId: alarm.tagId,
      text,
      ts: Date.now(),
    });

    let lastError = '';
    for (let attempt = 1; attempt <= this.webhookRetries + 1; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.webhookTimeoutMs);
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) return { status: 'delivered', attempts: attempt };
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        clearTimeout(timer);
        lastError = err.name === 'AbortError' ? 'timeout' : err.message;
      }
      if (attempt <= this.webhookRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    // 广播外发失败不能静默：大屏/控制台渠道已经发出，webhook 失败计入记录供运维排查
    console.error(`[broadcast] webhook 投递失败(${lastError})，告警 ${alarm.id}`);
    return { status: 'failed', attempts: this.webhookRetries + 1, error: lastError };
  }
}
