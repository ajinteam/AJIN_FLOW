import type { VercelRequest, VercelResponse } from '@vercel/node';
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
  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return res.status(400).json({
      error: 'Cloudflare R2 is not configured in Vercel environment variables.',
      configured: false,
    });
  }

  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const folders = ['info-pdf', 'info-excel', 'info-image'];
    const allObjects: Array<{
      key: string;
      folder: string;
      fileName: string;
      size: number;
      lastModified?: string;
      url: string;
      fileType: 'pdf' | 'excel' | 'image' | 'other';
    }> = [];

    for (const folder of folders) {
      const response = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${folder}/`,
          MaxKeys: 1000,
        })
      );

      if (response.Contents) {
        for (const item of response.Contents) {
          if (!item.Key || item.Key === `${folder}/`) continue;
          
          const rawFileName = item.Key.substring(folder.length + 1);
          // Strip timestamp prefix if formatted like 1724000000000_filename.png
          const displayName = rawFileName.replace(/^[0-9]+_/, '');
          
          let fileType: 'pdf' | 'excel' | 'image' | 'other' = 'other';
          if (folder === 'info-pdf') fileType = 'pdf';
          else if (folder === 'info-excel') fileType = 'excel';
          else if (folder === 'info-image') fileType = 'image';

          const fileUrl = publicUrl
            ? `${publicUrl.replace(/\/$/, '')}/${item.Key}`
            : `/api/files/${folder}/${encodeURIComponent(rawFileName)}`;

          allObjects.push({
            key: item.Key,
            folder,
            fileName: displayName,
            size: item.Size || 0,
            lastModified: item.LastModified ? item.LastModified.toISOString() : undefined,
            url: fileUrl,
            fileType,
          });
        }
      }
    }

    return res.json({
      success: true,
      bucket,
      count: allObjects.length,
      objects: allObjects,
    });
  } catch (error: any) {
    console.error('R2 sync error:', error);
    return res.status(500).json({ error: 'Failed to sync R2 objects: ' + (error?.message || '') });
  }
}
