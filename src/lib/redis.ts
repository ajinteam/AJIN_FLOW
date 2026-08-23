import { Redis } from '@upstash/redis';

const url = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_URL ||
  process.env.REDIS_REST_URL ||
  ''
).trim();

const token = (
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_TOKEN ||
  process.env.REDIS_REST_TOKEN ||
  ''
).trim();

if (!url || !token) {
  console.warn('⚠️ Upstash Redis environment variables (KV_REST_API_URL / UPSTASH_REDIS_REST_URL) are missing.');
}

const redis = new Redis({
  url: url || '',
  token: token || '',
});

export default redis;
