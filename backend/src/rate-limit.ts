import { isIP } from 'node:net';

import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  trustProxyHeader?: boolean;
  now?: () => number;
  clientAddress?: (c: Context) => string | undefined;
}

export function createRateLimit(options: RateLimitOptions): MiddlewareHandler {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('Invalid rate limit');
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) throw new Error('Invalid rate window');

  const entries = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const socketAddress = options.clientAddress ?? ((c) => getConnInfo(c).remote.address);

  // A fixed window needs less state than a token bucket and gives callers an exact retry time.
  // Expired entries are swept on access, so no timer can leak or keep the process alive.
  // ponytail: this is an O(n) sweep; use an expiry index only if traffic makes it measurable.
  return async (c, next) => {
    const timestamp = now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= timestamp) entries.delete(key);
    }

    // A trusted proxy supplies the original client as the leftmost X-Forwarded-For entry.
    // Enable this only when the proxy overwrites or sanitizes the header. Enabling it for
    // direct traffic or an append-only proxy lets callers spoof fresh addresses and bypass us.
    const forwarded = c.req.header('X-Forwarded-For')?.split(',', 1)[0]?.trim();
    const key = options.trustProxyHeader && forwarded && isIP(forwarded)
      ? forwarded
      : socketAddress(c) ?? 'unknown';
    const entry = entries.get(key);
    if (entry && entry.count >= options.limit) {
      return c.json(
        { ok: false, error: 'Too many requests', code: 'rate_limited' },
        429,
        { 'Retry-After': String(Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000))) },
      );
    }

    if (entry) entry.count += 1;
    else entries.set(key, { count: 1, resetAt: timestamp + options.windowMs });
    await next();
  };
}
