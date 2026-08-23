import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileName, folder, contentType, fileSize } = req.body;

    if (!fileName || !folder) {
      return res.status(400).json({ error: 'Missing required parameters: fileName, folder' });
    }

    const validFolders = ['info-pdf', 'info-excel', 'info-image'];
    const targetFolder = validFolders.includes(folder) ? folder : 'info-pdf';

    const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const key = `${targetFolder}/${cleanFileName}`;

    const endpoint = getR2Endpoint();
    const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
    const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

    if (endpoint && accessKeyId && secretAccessKey) {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      });

      // Generate presigned PUT URL valid for 1 hour (3600 seconds)
      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      const finalFileUrl = publicUrl
        ? `${publicUrl.replace(/\/$/, '')}/${key}`
        : `/api/files/${targetFolder}/${encodeURIComponent(cleanFileName)}`;

      return res.json({
        isDirectR2: true,
        presignedUrl,
        storagePath: key,
        fileUrl: finalFileUrl,
        fileName: cleanFileName,
        folder: targetFolder,
      });
    }

    return res.json({
      isDirectR2: false,
      message: 'Cloudflare R2 is not configured; using local fallback',
    });
  } catch (error: any) {
    console.error('Presign generation error:', error);
    return res.status(500).json({ error: 'Failed to generate presigned URL: ' + (error?.message || '') });
  }
}
