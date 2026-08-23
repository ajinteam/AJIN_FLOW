import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

function getR2Endpoint(): string | null {
  if (process.env.R2_ENDPOINT) {
    let ep = process.env.R2_ENDPOINT.trim();
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
      ep = `https://${ep}`;
    }
    // Remove trailing bucket name if user pasted https://xxx.r2.cloudflarestorage.com/bucket-name
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

export function getR2Client(): { client: S3Client | null; bucket: string; publicUrl: string; endpoint: string | null; isConfigured: boolean } {
  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

  const isConfigured = Boolean(endpoint && accessKeyId && secretAccessKey);

  if (!isConfigured) {
    return { client: null, bucket, publicUrl, endpoint, isConfigured: false };
  }

  try {
    const client = new S3Client({
      region: 'auto',
      endpoint: endpoint!,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    return { client, bucket, publicUrl, endpoint, isConfigured: true };
  } catch (e) {
    console.error('Failed to create S3 client for R2:', e);
    return { client: null, bucket, publicUrl, endpoint, isConfigured: false };
  }
}
