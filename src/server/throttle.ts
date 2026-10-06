// Shared log throttle: suppress repeats within a window and let recovery
// re-arm the slot once. Callers use distinct keys per operation so one
// operation's health never announces another's.
export function createLogThrottle(now: () => number, windowMs = 60_000) {
  const lastLoggedAt = new Map<string, number>();
  return {
    // True when `key` may log now; records the time. Repeats within the window are suppressed.
    allow(key: string): boolean {
      const time = now();
      const previous = lastLoggedAt.get(key);
      if (previous !== undefined && time - previous < windowMs) return false;
      lastLoggedAt.set(key, time);
      return true;
    },
    // Clears `key`; returns whether it was armed, so recovery logs exactly once.
    clear(key: string): boolean {
      return lastLoggedAt.delete(key);
    },
  };
}
