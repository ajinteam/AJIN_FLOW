import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const INFO_REDIS_KEY = "ajin-info-files26";

function getRedisClient(): Redis | null {
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
    return null;
  }

  try {
    return new Redis({ url, token });
  } catch (e) {
    console.error('Failed to create Redis client for info-data:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redis = getRedisClient();

  if (!redis) {
    return res.json({
      projects: [],
      files: [],
      warning: "Redis configuration missing or unverified in Vercel environment."
    });
  }

  if (req.method === 'GET') {
    try {
      const data: any = await redis.get(INFO_REDIS_KEY);
      const defaults = {
        projects: [],
        files: [],
      };

      if (!data) {
        return res.json(defaults);
      }

      return res.json({
        ...defaults,
        ...data
      });
    } catch (error: any) {
      console.error("Redis fetch error for info-data:", error);
      return res.status(500).json({ error: "Failed to fetch info data from Redis: " + (error?.message || '') });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      await redis.set(INFO_REDIS_KEY, data);
      return res.json({ success: true });
    } catch (error: any) {
      console.error("Redis save error for info-data:", error);
      return res.status(500).json({ error: "Failed to save info data to Redis: " + (error?.message || '') });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
