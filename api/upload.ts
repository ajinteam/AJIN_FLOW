import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getR2Endpoint(): string | null {
  if (process.env.R2_ENDPOINT) {
    let ep = process.env.R2_ENDPOINT.trim();
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
      ep = `https://${ep}`;
    }
    // Remove trailing bucket name or slash if present
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
    const { fileName, folder, base64Data, contentType } = req.body;

    if (!fileName || !folder || !base64Data) {
      return res.status(400).json({ error: 'Missing required fields: fileName, folder, base64Data' });
    }

    // 1. Separate folders by extension/type: info-pdf, info-excel, info-image
    const validFolders = ['info-pdf', 'info-excel', 'info-image'];
    const targetFolder = validFolders.includes(folder) ? folder : 'info-pdf';

    const pureBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(pureBase64, 'base64');
    const resolvedContentType =
      contentType ||
      (targetFolder === 'info-pdf'
        ? 'application/pdf'
        : targetFolder === 'info-excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'image/jpeg');

    // Storage path structure: info-pdf/filename, info-excel/filename, info-image/filename
    const key = `${targetFolder}/${fileName}`;

    const endpoint = getR2Endpoint();
    const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
    const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

    if (endpoint && accessKeyId && secretAccessKey) {
      console.log(`[Vercel Upload] Uploading to R2: endpoint=${endpoint}, bucket=${bucket}, key=${key}`);
      
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
        Body: buffer,
        ContentType: resolvedContentType,
      });

      await s3Client.send(command);

      const finalUrl = publicUrl
        ? `${publicUrl.replace(/\/$/, '')}/${key}`
        : `/api/files/${targetFolder}/${encodeURIComponent(fileName)}`;

      return res.json({
        success: true,
        fileName,
        folder: targetFolder,
        storagePath: key,
        fileUrl: finalUrl,
        fileSize: buffer.length,
        storedIn: 'Cloudflare_R2',
      });
    }

    console.warn('[Vercel Upload] R2 environment variables not complete. Endpoint:', endpoint, 'AccessKey:', Boolean(accessKeyId));

    // Fallback if R2 not configured
    return res.json({
      success: true,
      fileName,
      folder: targetFolder,
      storagePath: key,
      fileUrl: base64Data,
      fileSize: buffer.length,
      storedIn: 'Fallback_Local_Base64',
    });
  } catch (error: any) {
    console.error('Vercel upload error:', error);
    return res.status(500).json({ error: 'Failed to upload: ' + (error?.message || 'Unknown error') });
  }
}
