import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const RS_PARTS_REDIS_KEY = 'ajin-rs-parts26';

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
    console.error('Failed to create Redis client for rs-parts:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redis = getRedisClient();

  if (!redis) {
    return res.json({
      files: [],
      warning: 'Redis configuration missing or unverified in Vercel environment.',
    });
  }

  if (req.method === 'GET') {
    try {
      const data: any = await redis.get(RS_PARTS_REDIS_KEY);
      if (!data) {
        return res.json({ files: [] });
      }
      return res.json({
        files: Array.isArray(data.files) ? data.files : [],
      });
    } catch (error: any) {
      console.error('Redis fetch error for rs-parts:', error);
      return res.status(500).json({ error: 'Failed to fetch RS Parts data from Redis: ' + (error?.message || '') });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      await redis.set(RS_PARTS_REDIS_KEY, {
        files: Array.isArray(data?.files) ? data.files : [],
      });
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Redis save error for rs-parts:', error);
      return res.status(500).json({ error: 'Failed to save RS Parts data to Redis: ' + (error?.message || '') });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
