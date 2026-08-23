import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const INFO_REDIS_KEY = "ajin-info-files26";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.json({
      projects: [],
      files: [],
      warning: "Redis configuration missing."
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
      return res.status(500).json({ error: "Failed to fetch info data from Redis" });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      await redis.set(INFO_REDIS_KEY, data);
      return res.json({ success: true });
    } catch (error) {
      console.error("Redis save error for info-data:", error);
      return res.status(500).json({ error: "Failed to save info data to Redis" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
