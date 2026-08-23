import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

function getR2Endpoint(): string | null {
  if (process.env.R2_ENDPOINT) {
    let ep = process.env.R2_ENDPOINT.trim();
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
      ep = `https://${ep}`;
    }
    const match = ep.match(/^(https:\/\/[a-zA-Z0-9_-]+\.r2\.cloudflarestorage\.com)/i);
    if (match) {
      return match[1];
    }
    return ep.replace(/\/+$/, '');
  }

  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (accountId) {
    return `https://${accountId.trim()}.r2.cloudflarestorage.com`;
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redisUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL || '').trim();
  const redisToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN || '').trim();

  const r2Endpoint = getR2Endpoint();
  const r2AccessKey = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const r2Secret = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const r2Bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();

  // Test Redis
  let redisResult: any = { configured: Boolean(redisUrl && redisToken), status: 'not_configured' };
  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({ url: redisUrl, token: redisToken });
      const ping = await redis.ping();
      const flowData: any = await redis.get('ajin_flow26_Backup');
      const infoData: any = await redis.get('ajin-info-files26');

      redisResult = {
        configured: true,
        status: ping === 'PONG' ? 'connected' : 'error',
        ping,
        flowProjectsCount: flowData?.projects?.length || 0,
        infoProjectsCount: infoData?.projects?.length || 0,
        infoFilesCount: infoData?.files?.length || 0,
      };
    } catch (e: any) {
      redisResult = {
        configured: true,
        status: 'connection_failed',
        error: e?.message || 'Unknown error',
      };
    }
  }

  // Test R2
  let r2Result: any = {
    configured: Boolean(r2Endpoint && r2AccessKey && r2Secret),
    endpoint: r2Endpoint,
    bucket: r2Bucket,
    status: 'not_configured',
  };

  if (r2Endpoint && r2AccessKey && r2Secret) {
    try {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: r2AccessKey,
          secretAccessKey: r2Secret,
        },
      });

      const listRes = await s3Client.send(new ListObjectsV2Command({
        Bucket: r2Bucket,
        MaxKeys: 20,
      }));

      r2Result = {
        configured: true,
        status: 'connected',
        bucket: r2Bucket,
        endpoint: r2Endpoint,
        sampleObjectsCount: listRes.KeyCount || 0,
        sampleKeys: (listRes.Contents || []).map((c) => c.Key),
      };
    } catch (e: any) {
      r2Result = {
        configured: true,
        status: 'connection_failed',
        bucket: r2Bucket,
        endpoint: r2Endpoint,
        error: e?.message || 'Unknown error',
      };
    }
  }

  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cloud: {
      redis: redisResult,
      r2Storage: r2Result,
    },
  });
}
