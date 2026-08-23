import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

export function getR2S3Client() {
  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return { client, bucket, publicUrl, endpoint };
}

export async function getR2PresignedPutUrl(
  folder: 'info-pdf' | 'info-excel' | 'info-image',
  fileName: string,
  contentType?: string
): Promise<{ presignedUrl: string; fileUrl: string; key: string } | null> {
  const r2 = getR2S3Client();
  if (!r2) return null;

  const key = `${folder}/${fileName}`;
  const command = new PutObjectCommand({
    Bucket: r2.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });

  const presignedUrl = await getSignedUrl(r2.client, command, { expiresIn: 3600 });
  const fileUrl = r2.publicUrl
    ? `${r2.publicUrl.replace(/\/$/, '')}/${key}`
    : `/api/files/${folder}/${encodeURIComponent(fileName)}`;

  return { presignedUrl, fileUrl, key };
}

export async function listAllR2Objects() {
  const r2 = getR2S3Client();
  if (!r2) {
    return { success: false, configured: false, count: 0, objects: [] };
  }

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
    const res = await r2.client.send(
      new ListObjectsV2Command({
        Bucket: r2.bucket,
        Prefix: `${folder}/`,
        MaxKeys: 1000,
      })
    );

    if (res.Contents) {
      for (const item of res.Contents) {
        if (!item.Key || item.Key === `${folder}/`) continue;
        const rawFileName = item.Key.substring(folder.length + 1);
        const displayName = rawFileName.replace(/^[0-9]+_/, '');

        let fileType: 'pdf' | 'excel' | 'image' | 'other' = 'other';
        if (folder === 'info-pdf') fileType = 'pdf';
        else if (folder === 'info-excel') fileType = 'excel';
        else if (folder === 'info-image') fileType = 'image';

        const fileUrl = r2.publicUrl
          ? `${r2.publicUrl.replace(/\/$/, '')}/${item.Key}`
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

  return {
    success: true,
    configured: true,
    bucket: r2.bucket,
    count: allObjects.length,
    objects: allObjects,
  };
}
