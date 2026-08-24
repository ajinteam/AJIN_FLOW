import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const endpoint = getR2Endpoint();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || 'ajin-info-files').trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return res.status(400).json({ error: 'Cloudflare R2 is not configured in Vercel environment' });
  }

  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  const { action } = req.body;

  try {
    // 1. START Multipart Upload
    if (action === 'start') {
      const { fileName, folder, contentType } = req.body;
      const validFolders = ['info-pdf', 'info-excel', 'info-image'];
      const targetFolder = validFolders.includes(folder) ? folder : 'info-pdf';
      const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const key = `${targetFolder}/${cleanFileName}`;

      const command = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      });

      const response = await s3Client.send(command);
      return res.json({
        uploadId: response.UploadId,
        key,
        cleanFileName,
        folder: targetFolder,
      });
    }

    // 2. UPLOAD PART (3MB chunk)
    if (action === 'part') {
      const { uploadId, key, partNumber, base64Chunk } = req.body;
      if (!uploadId || !key || !partNumber || !base64Chunk) {
        return res.status(400).json({ error: 'Missing part upload parameters' });
      }

      const pureBase64 = base64Chunk.includes(',') ? base64Chunk.split(',')[1] : base64Chunk;
      const buffer = Buffer.from(pureBase64, 'base64');

      const command = new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: Number(partNumber),
        Body: buffer,
      });

      const response = await s3Client.send(command);
      return res.json({
        partNumber: Number(partNumber),
        eTag: response.ETag,
      });
    }

    // 3. COMPLETE Multipart Upload
    if (action === 'complete') {
      const { uploadId, key, parts, folder, cleanFileName } = req.body;
      if (!uploadId || !key || !parts || !Array.isArray(parts)) {
        return res.status(400).json({ error: 'Missing completion parameters' });
      }

      const command = new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p: any) => ({
            PartNumber: p.partNumber,
            ETag: p.eTag,
          })),
        },
      });

      await s3Client.send(command);

      const finalUrl = publicUrl
        ? `${publicUrl.replace(/\/$/, '')}/${key}`
        : `/api/files/${folder}/${encodeURIComponent(cleanFileName)}`;

      return res.json({
        success: true,
        storagePath: key,
        fileUrl: finalUrl,
        fileName: cleanFileName,
      });
    }

    // 4. ABORT
    if (action === 'abort') {
      const { uploadId, key } = req.body;
      if (uploadId && key) {
        await s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          })
        );
      }
      return res.json({ success: true, aborted: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err: any) {
    console.error('Multipart upload chunk error:', err);
    return res.status(500).json({ error: err?.message || 'Multipart upload failed' });
  }
}
