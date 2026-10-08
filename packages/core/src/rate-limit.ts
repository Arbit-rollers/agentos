import type { Redis } from 'ioredis';
import { AppError } from './errors';

/** Counts hits per key in fixed windows (v0.6 reliability). */
export type RateLimiter = {
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }>;
};

/** Limits for actions people take directly; automated work (schedules, delegation) isn't limited. */
export const RATE_LIMITS = {
  /** Sign-in attempts per email address, and per client address. */
  loginEmail: { limit: 10, windowMs: 15 * 60_000 },
  loginIp: { limit: 50, windowMs: 15 * 60_000 },
  /** New accounts per client address. */
  register: { limit: 10, windowMs: 60 * 60_000 },
  /** Chat messages and new tasks per person. */
  runs: { limit: 30, windowMs: 60_000 },
} as const;
export type RateLimitRule = keyof typeof RATE_LIMITS;

/** Shared across web servers through Redis: INCR on a key that expires with its window. */
export function redisRateLimiter(redis: Redis, prefix = 'agentos:ratelimit:'): RateLimiter {
  return {
    async hit(key, limit, windowMs) {
      const name = `${prefix}${key}`;
      const results = await redis.multi().incr(name).pttl(name).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      let ttl = Number(results?.[1]?.[1] ?? -1);
      // First hit of a window (or a key that lost its expiry): start the window now. Plain
      // PEXPIRE rather than the NX flag keeps this working on Redis 6.
      if (ttl < 0) {
        await redis.pexpire(name, windowMs);
        ttl = windowMs;
      }
      return { allowed: count <= limit, retryAfterMs: count <= limit ? 0 : ttl };
    },
  };
}

/** One process only; for tests and single-node development. */
export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, limit, windowMs) {
      const at = now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= at) {
        entry = { count: 0, resetAt: at + windowMs };
        windows.set(key, entry);
      }
      entry.count += 1;
      const allowed = entry.count <= limit;
      return { allowed, retryAfterMs: allowed ? 0 : entry.resetAt - at };
    },
  };
}

/** Throws RATE_LIMITED (with the seconds to wait) once `key` is over the rule's limit. */
export async function enforceRateLimit(
  limiter: RateLimiter | undefined,
  rule: RateLimitRule,
  key: string,
): Promise<void> {
  if (!limiter) return;
  const { limit, windowMs } = RATE_LIMITS[rule];
  const { allowed, retryAfterMs } = await limiter.hit(`${rule}:${key}`, limit, windowMs);
  if (!allowed) {
    throw new AppError('RATE_LIMITED', 'Too many requests', {
      retryAfterSeconds: [String(Math.max(1, Math.ceil(retryAfterMs / 1000)))],
    });
  }
}
