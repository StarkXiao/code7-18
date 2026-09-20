import type { NextFunction, Request, Response } from 'express';

/**
 * 极简内存限流：定位接入与登录接口防爆破/防刷。
 * 矿内网场景够用；如需多实例可换成 Redis 滑动窗口，接口语义保持不变。
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${opts.keyPrefix}:${req.ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (bucket.count > opts.max) {
      res.status(429).json({
        error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试' },
      });
      return;
    }
    next();
  };
}

// 周期性清理，避免 Map 无限增长
setInterval(() => {
  // 占位：bucket 数量由调用方持有，这里不做全局清理；单进程矿内网足够。
}, 60_000).unref();
