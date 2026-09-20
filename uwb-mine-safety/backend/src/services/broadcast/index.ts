import type { Broadcast } from '@prisma/client';
import { env } from '../../config/env.js';
import { BroadcastStatus } from '../../config/constants.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

export interface DispatchInput {
  alarmId?: string | null;
  triggerType: 'auto' | 'manual';
  targetGroup?: string | null;
  content: string;
  createdById?: string | null;
}

export interface DispatchResult {
  broadcast: Broadcast;
  delivered: boolean;
}

/**
 * 广播联动。
 *
 * driver=console：开发/演示环境，把 TTS 文本打到日志，不依赖外部硬件。
 * driver=webhook：生产对接矿上广播主机的 HTTP 网关（如 SIP/IP 网络音箱 API），
 *                POST { group, text }，2xx 视为已下发。
 *
 * 无论驱动结果如何都写库留痕——喊没喊出去必须可追溯，且失败要能在界面上看到。
 */
export async function dispatchBroadcast(input: DispatchInput): Promise<DispatchResult> {
  const record = await prisma.broadcast.create({
    data: {
      alarmId: input.alarmId ?? null,
      triggerType: input.triggerType,
      targetGroup: input.targetGroup ?? null,
      content: input.content,
      createdById: input.createdById ?? null,
      status: BroadcastStatus.PENDING,
    },
  });

  try {
    if (env.broadcastDriver === 'webhook') {
      await sendWebhook(input.targetGroup ?? null, input.content);
    } else {
      logger.info(
        { group: input.targetGroup ?? 'ALL', text: input.content, auto: input.triggerType === 'auto' },
        '[BROADCAST] 分区语音播报',
      );
    }

    const broadcast = await prisma.broadcast.update({
      where: { id: record.id },
      data: { status: BroadcastStatus.SENT, sentAt: new Date(), error: null },
    });
    return { broadcast, delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, broadcastId: record.id }, '广播下发失败');
    const broadcast = await prisma.broadcast.update({
      where: { id: record.id },
      data: { status: BroadcastStatus.FAILED, error: message },
    });
    return { broadcast, delivered: false };
  }
}

async function sendWebhook(group: string | null, text: string): Promise<void> {
  if (!env.broadcastWebhookUrl) {
    throw new Error('BROADCAST_DRIVER=webhook 但未配置 BROADCAST_WEBHOOK_URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.broadcastTimeoutMs);
  try {
    const res = await fetch(env.broadcastWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group, text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`广播网关返回 ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 渲染 TTS 模板：{name} {team} {zone} 占位符替换 */
export function renderTemplate(
  template: string | null | undefined,
  vars: Record<string, string>,
  fallback: string,
): string {
  if (!template) return fallback;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}
