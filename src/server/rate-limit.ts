// Fixed-window rate limiter for a single bounded surface.
//
// Process-local by design: it caps one instance's write amplification (for
// example the unauthenticated player-creation endpoint), not a whole fleet.
// Deployments with multiple instances would need a shared store instead; the
// README states this limitation. Expired keys are pruned opportunistically so
// the map cannot grow without bound under many distinct clients.
export interface RateLimitPolicy {
  /** Requests allowed per key within one window. */
  limit: number;
  windowMs: number;
}

/** New players a single client address may create per minute. */
export const playerCreationPolicy: RateLimitPolicy = {
  limit: 10,
  windowMs: 60_000,
};

const PRUNE_THRESHOLD = 10_000;

export function createRateLimiter(policy: RateLimitPolicy, now: () => number) {
  const windows = new Map<string, { count: number; startedAt: number }>();

  function prune(time: number) {
    for (const [key, window] of windows) {
      if (time - window.startedAt >= policy.windowMs) windows.delete(key);
    }
  }

  return {
    /** True and counts the request when under the limit; false when throttled. */
    allow(key: string): boolean {
      const time = now();
      const window = windows.get(key);
      if (window === undefined || time - window.startedAt >= policy.windowMs) {
        if (windows.size >= PRUNE_THRESHOLD) prune(time);
        windows.set(key, { count: 1, startedAt: time });
        return true;
      }
      if (window.count >= policy.limit) return false;
      window.count += 1;
      return true;
    },
    /** Whole seconds a throttled client should wait before retrying. */
    retryAfterSeconds(): number {
      return Math.ceil(policy.windowMs / 1000);
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
