import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const REDIS_KEY = "ajin_flow26_Backup";

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
    console.error('Failed to create Redis client:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redis = getRedisClient();

  if (!redis) {
    return res.status(500).json({ 
      error: "Redis configuration missing. Please check KV_REST_API_URL and KV_REST_API_TOKEN in Vercel Settings." 
    });
  }

  if (req.method === 'GET') {
    try {
      const data: any = await redis.get(REDIS_KEY);
      const defaults = {
        users: [],
        projects: [],
        processes: [],
        tasks: [],
        processParts: []
      };
      
      if (!data) {
        return res.json(defaults);
      }

      return res.json({
        ...defaults,
        ...data
      });
    } catch (error: any) {
      console.error("Redis fetch error:", error);
      if (error?.message?.includes('WRONGTYPE')) {
        const actualType = await redis.type(REDIS_KEY).catch(() => 'unknown');
        return res.status(500).json({ 
          error: `Redis key "${REDIS_KEY}" holds the wrong data type (${actualType}). Please delete or rename this key in your Upstash console and try again.` 
        });
      }
      return res.status(500).json({ error: "Failed to fetch data from Redis: " + (error?.message || '') });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      await redis.set(REDIS_KEY, data);
      return res.json({ success: true });
    } catch (error: any) {
      console.error("Redis save error:", error);
      return res.status(500).json({ error: "Failed to save data to Redis: " + (error?.message || '') });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
