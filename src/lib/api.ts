import { InfoDataState, InfoFile, InfoFolderType, InfoProject } from '../types';
import { compressImage } from './imageCompressor';
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

export async function deleteFileFromServer(folder: string, fileName: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to delete file from server:', err);
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

  // 3. STEP A: Direct Presigned Upload to Cloudflare R2 (Bypasses Vercel 4.5MB limit for 10MB, 20MB, 50MB+ files)
  let serverStoragePath = `${folder}/${Date.now()}_${file.name}`;
  let fileUrl = '';
  let directR2Success = false;

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
        // Upload directly from browser to Cloudflare R2!
        const uploadRes = await fetch(presignData.presignedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': processedFile.type || 'application/octet-stream',
          },
          body: processedFile,
        });

        if (uploadRes.ok) {
          directR2Success = true;
          serverStoragePath = presignData.storagePath;
          fileUrl = presignData.fileUrl;
          console.log(`[R2 Direct Upload] Successfully uploaded ${file.name} directly to Cloudflare R2 (${formatFileSize(processedFile.size)})`);
        }
      }
    }
  } catch (presignErr) {
    console.warn('[R2 Direct Upload] Presign attempt failed, attempting fallback:', presignErr);
  }

  // STEP B: Fallback if Direct R2 upload was not available or failed
  if (!directR2Success) {
    if (!dataUrl && processedFile.size < 15 * 1024 * 1024) {
      // Only generate base64 if reasonable size
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
