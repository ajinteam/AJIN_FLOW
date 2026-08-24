import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

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
  const folder = (req.query.folder as string) || '';
  const fileName = (req.query.file as string) || (req.query.fileName as string) || '';

  if (!folder || !fileName) {
    return res.status(400).json({ error: 'folder and file parameters are required' });
  }

  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return res.status(404).json({ error: 'R2 storage is not configured' });
  }

  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const key = `${folder}/${fileName}`;

  if (req.method === 'DELETE') {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      return res.json({ success: true, deleted: key });
    } catch (e: any) {
      return res.status(500).json({ error: 'Delete failed: ' + (e?.message || '') });
    }
  }

  if (req.method === 'GET') {
    try {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }));

      if (response.ContentType) {
        res.setHeader('Content-Type', response.ContentType);
      }
      if (response.ContentLength) {
        res.setHeader('Content-Length', response.ContentLength);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      if (response.Body instanceof Readable) {
        response.Body.pipe(res);
      } else if (response.Body) {
        const byteArray = await response.Body.transformToByteArray();
        res.send(Buffer.from(byteArray));
      } else {
        res.status(404).json({ error: 'File body empty' });
      }
    } catch (e: any) {
      return res.status(404).json({ error: 'File not found in R2: ' + key });
    }
  }
}
