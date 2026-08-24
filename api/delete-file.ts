import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

function getR2Endpoint(): string | null {
  if (process.env.R2_ENDPOINT) {
    let ep = process.env.R2_ENDPOINT.trim();
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) ep = `https://${ep}`;
    const match = ep.match(/^(https:\/\/[a-zA-Z0-9_-]+\.r2\.cloudflarestorage\.com)/i);
    return match ? match[1] : ep.replace(/\/+$/, '');
  }
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  return accountId ? `https://${accountId.trim()}.r2.cloudflarestorage.com` : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { storagePath, folder, fileName } = req.body || req.query;
  const targetKey = (storagePath as string) || (folder && fileName ? `${folder}/${fileName}` : '');

  if (!targetKey) {
    return res.status(400).json({ error: 'storagePath or folder+fileName required' });
  }

  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();

  if (endpoint && accessKeyId && secretAccessKey) {
    try {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: targetKey }));
      return res.json({ success: true, deletedKey: targetKey });
    } catch (e: any) {
      console.error('Delete error from R2:', e);
      return res.status(500).json({ error: e?.message || 'Failed to delete from R2' });
    }
  }

  return res.json({ success: true, deletedKey: targetKey, message: 'Local storage fallback delete' });
}
