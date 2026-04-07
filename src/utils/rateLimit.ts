/**
 * Simple in-memory rate limiter for Fastify route handlers.
 * Creates an isolated rate limit scope per call to createRateLimiter,
 * so each route group maintains its own counters.
 */
export interface RateLimiterOptions {
  /** Maximum requests per window per IP. Default: 20. */
  max?: number;
  /** Window duration in milliseconds. Default: 60_000. */
  windowMs?: number;
}

export interface RateLimiter {
  /** Returns true if the request is within the rate limit, false otherwise. */
  check(ip: string): boolean;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const max = options.max ?? 20;
  const windowMs = options.windowMs ?? 60_000;
  const map = new Map<string, { count: number; resetAt: number }>();

  return {
    check(ip: string): boolean {
      const now = Date.now();
      const entry = map.get(ip);
      if (!entry || now > entry.resetAt) {
        map.set(ip, { count: 1, resetAt: now + windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= max;
    },
  };
}
