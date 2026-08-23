import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const REDIS_KEY = "ajin_flow26_Backup";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ 
      error: "Redis configuration missing. Please set KV_REST_API_URL and KV_REST_API_TOKEN in settings." 
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
      return res.status(500).json({ error: "Failed to fetch data from Redis" });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      await redis.set(REDIS_KEY, data);
      return res.json({ success: true });
    } catch (error) {
      console.error("Redis save error:", error);
      return res.status(500).json({ error: "Failed to save data to Redis" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
