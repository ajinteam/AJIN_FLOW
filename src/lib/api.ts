import { InfoDataState, InfoFile, InfoFolderType, InfoProject } from '../types';
import { compressImage, formatFileSize } from './imageCompressor';
import * as XLSX from 'xlsx';

const LOCAL_STORAGE_INFO_KEY = 'ajin_info_data_local_v2';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export async function fetchInfoData(): Promise<InfoDataState> {
  try {
    const res = await fetch('/api/info-data');
    if (res.ok) {
      const data = await res.json();
      const cleanedData = autoPurgeOldTrash(data);
      localStorage.setItem(LOCAL_STORAGE_INFO_KEY, JSON.stringify(cleanedData));
      return cleanedData;
    }
  } catch (err) {
    console.warn('Failed to fetch from /api/info-data, falling back to localStorage', err);
  }

  const cached = localStorage.getItem(LOCAL_STORAGE_INFO_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return autoPurgeOldTrash(parsed);
    } catch {
      // ignore
    }
  }

  return { projects: [], files: [] };
}

export async function saveInfoData(data: InfoDataState): Promise<boolean> {
  // Save locally first for instant UI response
  localStorage.setItem(LOCAL_STORAGE_INFO_KEY, JSON.stringify(data));

  try {
    const res = await fetch('/api/info-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to sync info data to server:', err);
    return false;
  }
}

/**
 * Automatically purge items in Trash that have been deleted for more than 3 days
 */
export function autoPurgeOldTrash(data: InfoDataState): InfoDataState {
  const now = Date.now();
  
  const filesToKeep: InfoFile[] = [];
  const purgedFileIds: string[] = [];

  for (const f of data.files || []) {
    if (f.status === 'trash' && f.deletedAt) {
      const deletedTime = new Date(f.deletedAt).getTime();
      if (now - deletedTime > THREE_DAYS_MS) {
        purgedFileIds.push(f.id);
        // Fire & forget delete from server/R2
        deleteFileFromServer(f.folder, f.fileName).catch(() => {});
        continue;
      }
    }
    filesToKeep.push(f);
  }

  const projectsToKeep: InfoProject[] = [];
  for (const p of data.projects || []) {
    if (p.status === 'trash' && p.deletedAt) {
      const deletedTime = new Date(p.deletedAt).getTime();
      if (now - deletedTime > THREE_DAYS_MS) {
        continue;
      }
    }
    projectsToKeep.push(p);
  }

  return {
    projects: projectsToKeep,
    files: filesToKeep,
  };
}

export async function deleteFileFromServer(folder: string, fileName: string, storagePath?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storagePath: storagePath || `${folder}/${fileName}`,
        folder,
        fileName,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to delete file from server/R2:', err);
    return false;
  }
}

export function detectFileTypeAndFolder(file: File): {
  fileType: 'pdf' | 'excel' | 'image' | 'other';
  folder: InfoFolderType;
} {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (name.endsWith('.pdf') || type === 'application/pdf') {
    return { fileType: 'pdf', folder: 'info-pdf' };
  }

  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    name.endsWith('.csv') ||
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    type === 'text/csv'
  ) {
    return { fileType: 'excel', folder: 'info-excel' };
  }

  if (
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp') ||
    name.endsWith('.gif') ||
    name.endsWith('.heic') ||
    type.startsWith('image/')
  ) {
    return { fileType: 'image', folder: 'info-image' };
  }

  return { fileType: 'other', folder: 'info-pdf' };
}

export async function syncFilesFromR2(): Promise<{
  success: boolean;
  configured: boolean;
  bucket?: string;
  count: number;
  objects: Array<{
    key: string;
    folder: string;
    fileName: string;
    size: number;
    lastModified?: string;
    url: string;
    fileType: 'pdf' | 'excel' | 'image' | 'other';
  }>;
}> {
  try {
    const res = await fetch('/api/sync-r2');
    if (!res.ok) throw new Error('Failed to fetch R2 files');
    return await res.json();
  } catch (err: any) {
    console.error('R2 sync fetch error:', err);
    return { success: false, configured: false, count: 0, objects: [] };
  }
}

export async function uploadFileInChunks(
  file: File,
  folder: string,
  onProgress?: (percent: number) => void
): Promise<{ storagePath: string; fileUrl: string; cleanFileName: string } | null> {
  try {
    const CHUNK_SIZE = 2.5 * 1024 * 1024; // 2.5MB per chunk (always safe for Vercel's 4.5MB limit)

    // 1. Start multipart upload
    const startRes = await fetch('/api/upload-chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        fileName: file.name,
        folder,
        contentType: file.type || 'application/octet-stream',
      }),
    });

    if (!startRes.ok) {
      console.warn('Chunk start failed:', await startRes.text());
      return null;
    }

    const { uploadId, key, cleanFileName } = await startRes.json();
    const totalParts = Math.ceil(file.size / CHUNK_SIZE);
    const parts: { partNumber: number; eTag: string }[] = [];

    for (let i = 0; i < totalParts; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);

      const base64Chunk = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(chunkBlob);
      });

      const partRes = await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'part',
          uploadId,
          key,
          partNumber: i + 1,
          base64Chunk,
        }),
      });

      if (!partRes.ok) {
        console.error(`Part ${i + 1} upload failed`);
        await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'abort', uploadId, key }),
        }).catch(() => {});
        return null;
      }

      const partData = await partRes.json();
      parts.push({ partNumber: i + 1, eTag: partData.eTag });

      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalParts) * 100));
      }
    }

    // 3. Complete multipart upload
    const completeRes = await fetch('/api/upload-chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'complete',
        uploadId,
        key,
        parts,
        folder,
        cleanFileName,
      }),
    });

    if (!completeRes.ok) {
      console.error('Complete chunk upload failed');
      return null;
    }

    const completeData = await completeRes.json();
    console.log(`[R2 Chunked Upload] Successfully uploaded ${file.name} to Cloudflare R2 (${formatFileSize(file.size)})`);
    return completeData;
  } catch (err) {
    console.error('Chunk upload error:', err);
    return null;
  }
}

export async function uploadSingleFile(
  file: File,
  projectId: string,
  uploadedBy: string,
  onProgress?: (percent: number) => void
): Promise<{ infoFile: InfoFile; savedPercent?: number }> {
  const { fileType, folder } = detectFileTypeAndFolder(file);
  let processedFile = file;
  let dataUrl = '';
  let originalSize = file.size;
  let compressedSize = file.size;
  let savedPercent = 0;
  let excelSheets: string[] | undefined;

  // 1. Optimize images automatically on mobile client
  if (fileType === 'image') {
    try {
      const compResult = await compressImage(file, 1920, 0.82);
      processedFile = compResult.file;
      dataUrl = compResult.dataUrl;
      originalSize = compResult.originalSize;
      compressedSize = compResult.compressedSize;
      savedPercent = compResult.savedPercent;
    } catch (e) {
      console.warn('Image compression fallback:', e);
    }
  }

  // 2. Parse Excel sheet names for instant mobile preview
  if (fileType === 'excel') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      excelSheets = workbook.SheetNames;
    } catch (e) {
      console.warn('Excel parse preview warning:', e);
    }
  }

  let serverStoragePath = `${folder}/${Date.now()}_${file.name}`;
  let fileUrl = '';
  let r2Uploaded = false;

  // 3. STEP A: Direct Presigned Upload (Fastest if R2 CORS is allowed)
  try {
    const presignRes = await fetch('/api/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        folder,
        contentType: processedFile.type || 'application/octet-stream',
        fileSize: processedFile.size,
      }),
    });

    if (presignRes.ok) {
      const presignData = await presignRes.json();
      if (presignData.isDirectR2 && presignData.presignedUrl) {
        const uploadRes = await fetch(presignData.presignedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': processedFile.type || 'application/octet-stream',
          },
          body: processedFile,
        });

        if (uploadRes.ok) {
          r2Uploaded = true;
          serverStoragePath = presignData.storagePath;
          fileUrl = presignData.fileUrl;
          console.log(`[R2 Direct Upload] Successfully uploaded ${file.name} to Cloudflare R2`);
        }
      }
    }
  } catch (presignErr) {
    console.warn('[R2 Direct Upload] Presign failed, trying chunked upload:', presignErr);
  }

  // 4. STEP B: Chunked Multipart Upload (Bypasses Vercel 4.5MB limit for 10MB, 20MB, 50MB+ even without R2 CORS)
  if (!r2Uploaded && processedFile.size > 2 * 1024 * 1024) {
    console.log(`[R2 Chunked Upload] Starting chunked upload for ${file.name} (${formatFileSize(processedFile.size)})...`);
    const chunkResult = await uploadFileInChunks(processedFile, folder, onProgress);
    if (chunkResult) {
      r2Uploaded = true;
      serverStoragePath = chunkResult.storagePath;
      fileUrl = chunkResult.fileUrl;
    }
  }

  // 5. STEP C: Standard base64 upload for smaller files (< 2MB)
  if (!r2Uploaded) {
    if (!dataUrl && processedFile.size < 4 * 1024 * 1024) {
      try {
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(processedFile);
        });
      } catch (e) {
        console.warn('FileReader failed:', e);
      }
    }

    if (dataUrl) {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
            folder,
            base64Data: dataUrl,
            contentType: processedFile.type,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          serverStoragePath = json.storagePath || serverStoragePath;
          fileUrl = json.fileUrl || fileUrl;
          r2Uploaded = true;
        }
      } catch (err) {
        console.warn('Server upload error, using local data URL fallback:', err);
      }
    }

    if (!fileUrl) {
      fileUrl = dataUrl || URL.createObjectURL(processedFile);
    }
  }

  const newFileRecord: InfoFile = {
    id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    projectId,
    fileName: file.name,
    fileType,
    folder,
    storagePath: serverStoragePath,
    fileUrl,
    fileSize: compressedSize,
    mimeType: processedFile.type || 'application/octet-stream',
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    version: 1,
    originalSize,
    compressedSize,
    previewData: {
      excelSheets,
      thumbnailUrl: fileType === 'image' && dataUrl ? dataUrl : undefined,
    },
  };

  return { infoFile: newFileRecord, savedPercent };
}
