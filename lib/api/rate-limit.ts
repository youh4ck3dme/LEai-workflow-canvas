type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = params.now ?? Date.now();
  const current = buckets.get(params.key);
  const resetAt = current?.resetAt ?? now + params.windowMs;

  if (!current || current.resetAt <= now) {
    const next: Bucket = {
      count: 1,
      resetAt: now + params.windowMs,
    };
    buckets.set(params.key, next);
    return {
      allowed: true,
      limit: params.limit,
      remaining: params.limit - 1,
      resetAt: next.resetAt,
    };
  }

  const nextCount = current.count + 1;
  current.count = nextCount;
  buckets.set(params.key, current);

  const remaining = Math.max(0, params.limit - nextCount);
  return {
    allowed: nextCount <= params.limit,
    limit: params.limit,
    remaining,
    resetAt,
  };
}

