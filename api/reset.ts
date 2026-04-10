import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const REDIS_KEY = "ajin_flow26_Backup";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: "Redis configuration missing." });
  }

  try {
    await redis.del(REDIS_KEY);
    return res.json({ success: true });
  } catch (error) {
    console.error("Redis reset error:", error);
    return res.status(500).json({ error: "Failed to reset Redis data" });
  }
}
