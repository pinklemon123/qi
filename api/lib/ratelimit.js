// api/_lib/ratelimit.js
import redis from "./redis.js";

export async function rateLimit(ip, bucket, limit = 10, windowSec = 60) {
  const key = `rl:${bucket}:${ip}`;
  const p = redis.pipeline();
  p.incr(key);
  p.expire(key, windowSec);
  const results = await p.exec(); // 返回 [[null, n], [null, 1]]
  const count = Number(results?.[0]?.[1] ?? 1);
  return { allowed: count <= limit, remaining: Math.max(limit - count, 0) };
}
