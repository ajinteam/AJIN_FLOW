import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

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

const endpoint = getR2Endpoint();
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
export const BUCKET_NAME = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
export const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').trim();

export const isR2Configured = Boolean(endpoint && accessKeyId && secretAccessKey);

let s3Client: S3Client | null = null;

if (isR2Configured) {
  try {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: endpoint!,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });
    console.log(`[R2] Cloudflare R2 configured successfully for bucket "${BUCKET_NAME}" (endpoint: ${endpoint})`);
  } catch (err) {
    console.error('[R2] Failed to initialize Cloudflare R2 S3 client:', err);
    s3Client = null;
  }
} else {
  console.log('[R2] Cloudflare R2 environment variables not provided. Using local disk & proxy fallback.');
}

export async function uploadToR2(
  folder: 'info-pdf' | 'info-excel' | 'info-image',
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<{ success: boolean; storagePath: string; url: string }> {
  const key = `${folder}/${fileName}`;

  if (s3Client) {
    try {
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });
      await s3Client.send(command);

      const publicUrl = PUBLIC_URL 
        ? `${PUBLIC_URL.replace(/\/$/, '')}/${key}` 
        : `/api/files/${folder}/${encodeURIComponent(fileName)}`;

      console.log(`[R2] Uploaded file to R2: ${BUCKET_NAME}/${key}`);
      return { success: true, storagePath: key, url: publicUrl };
    } catch (err) {
      console.error(`[R2] Upload failed for ${key}:`, err);
    }
  }

  // Fallback URL served through local API
  return {
    success: true,
    storagePath: key,
    url: `/api/files/${folder}/${encodeURIComponent(fileName)}`,
  };
}

export async function deleteFromR2(folder: string, fileName: string): Promise<boolean> {
  const key = `${folder}/${fileName}`;
  if (s3Client) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });
      await s3Client.send(command);
      console.log(`[R2] Deleted file from R2: ${BUCKET_NAME}/${key}`);
      return true;
    } catch (err) {
      console.error(`[R2] Delete failed for ${key}:`, err);
      return false;
    }
  }
  return true;
}

export async function getFromR2(folder: string, fileName: string) {
  let client = s3Client;
  if (!client) {
    const currentEndpoint = getR2Endpoint();
    const currentAccessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const currentSecretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    if (currentEndpoint && currentAccessKeyId && currentSecretAccessKey) {
      try {
        client = new S3Client({
          region: 'auto',
          endpoint: currentEndpoint,
          credentials: {
            accessKeyId: currentAccessKeyId,
            secretAccessKey: currentSecretAccessKey,
          },
        });
        s3Client = client;
      } catch (e) {
        console.error('[R2] Client init on demand failed:', e);
      }
    }
  }

  if (client) {
    const keysToTry = [
      `${folder}/${fileName}`,
      fileName.includes('/') ? fileName : null,
      // If filename has timestamp prefix like 1787528476542_..., also try without prefix
      fileName.replace(/^[0-9]+_/, `${folder}/`),
      // Or just raw fileName directly
      fileName,
    ].filter(Boolean) as string[];

    for (const key of keysToTry) {
      try {
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });
        const response = await client.send(command);
        if (response && response.Body) {
          return response;
        }
      } catch (err: any) {
        // Continue trying next key variation
      }
    }
  }
  return null;
}
