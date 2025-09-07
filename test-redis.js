import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}

const redis = new Redis({ url, token });

try {
  const pong = await redis.ping();
  console.log("Redis connection OK:", pong);
} catch (err) {
  console.error("Redis connection failed:", err);
  process.exit(1);
}
