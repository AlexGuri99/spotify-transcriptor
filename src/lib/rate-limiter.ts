/* ------------------------------------------------------------------ */
/* Plan-aware sliding-window rate limiter for the v1 public API.      */
/* Each user (identified by email) gets their own counter pool,       */
/* with limits determined by their subscription plan.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number; // epoch ms when the short window resets
}

export type UserPlan = "free" | "credits" | "pro";

interface TierLimits {
  windowMs: number;
  maxRequests: number;
}

/* ------------------------------------------------------------------ */
/* Per-plan limits                                                    */
/* ------------------------------------------------------------------ */

const WINDOWS: TierLimits[] = [
  { windowMs: 60_000, maxRequests: 10 },   // short: 1 min
  { windowMs: 86_400_000, maxRequests: 100 }, // long: 24 h
];

const PLAN_LIMITS: Record<UserPlan, { short: number; long: number }> = {
  free: { short: 5, long: 30 },
  credits: { short: 10, long: 100 },
  pro: { short: 30, long: 500 },
};

/* ------------------------------------------------------------------ */
/* In-memory store — Map<email, { windowStart: timestamp[] }>          */
/* ------------------------------------------------------------------ */

interface WindowStore {
  /** timestamps of requests in the short (1 min) window */
  short: number[];
  /** timestamps of requests in the long (24 h) window */
  long: number[];
}

const store = new Map<string, WindowStore>();

/* ------------------------------------------------------------------ */
/* Core check                                                         */
/* ------------------------------------------------------------------ */

export function checkRateLimit(
  email: string,
  plan: UserPlan
): RateLimitResult {
  const now = Date.now();
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  let entry = store.get(email);
  if (!entry) {
    entry = { short: [], long: [] };
    store.set(email, entry);
  }

  // Prune stale entries
  entry.short = entry.short.filter((t) => now - t < WINDOWS[0].windowMs);
  entry.long = entry.long.filter((t) => now - t < WINDOWS[1].windowMs);

  // Check both windows
  const shortLimited = entry.short.length >= limits.short;
  const longLimited = entry.long.length >= limits.long;

  // Record this request (only if not already limited? Yes — count every hit)
  entry.short.push(now);
  entry.long.push(now);

  // Determine reset: the oldest timestamp in the offending window + window duration
  const oldestShort = entry.short[0] ?? now;
  const oldestLong = entry.long[0] ?? now;

  if (shortLimited) {
    return { limited: true, remaining: 0, resetAt: oldestShort + WINDOWS[0].windowMs };
  }
  if (longLimited) {
    return { limited: true, remaining: 0, resetAt: oldestLong + WINDOWS[1].windowMs };
  }

  return {
    limited: false,
    remaining: Math.min(
      limits.short - entry.short.length,
      limits.long - entry.long.length
    ),
    resetAt: oldestShort + WINDOWS[0].windowMs,
  };
}

/** Clean up stale entries periodically to avoid unbounded memory growth. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.short = entry.short.filter((t) => now - t < WINDOWS[0].windowMs);
    entry.long = entry.long.filter((t) => now - t < WINDOWS[1].windowMs);
    if (entry.short.length === 0 && entry.long.length === 0) {
      store.delete(key);
    }
  }
}, 60_000).unref();