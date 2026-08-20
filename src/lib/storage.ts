// Client-side Robust Persistent Storage using IndexedDB (Supports 500MB+ for Large PDFs & Excel Images)

const DB_NAME = 'AjinInfoDB';
const DB_VERSION = 1;
const STORE_FILES = 'project_files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLocalFileBlob(id: string, fileData: { blob?: Blob; dataUrl?: string; name: string; type: string }): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      store.put({ id, ...fileData, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB save notice:', err);
  }
}

export async function getLocalFileBlob(id: string): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB get notice:', err);
    return null;
  }
}

export async function getAllLocalFileBlobs(): Promise<Array<{ id: string; blob?: Blob; dataUrl?: string; name: string; type: string }>> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB getAll notice:', err);
    return [];
  }
}

// High-reliability Chunked Upload to server & Redis (handles 100KB to 100MB files flawlessly)
export async function uploadFileWithChunks(
  fileId: string,
  fileName: string,
  blob: Blob,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; url?: string; filename?: string; size?: number; error?: string }> {
  try {
    const CHUNK_SIZE = 500 * 1024; // 500KB per chunk
    const totalSize = blob.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const mimeType = blob.type || 'application/octet-stream';

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunkBlob = blob.slice(start, end);
      
      // Convert chunk to base64
      const arrayBuffer = await chunkBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      const len = uint8.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const dataBase64 = btoa(binary);

      let retry = 0;
      let success = false;
      let lastResult: any = null;

      while (retry < 3 && !success) {
        try {
          const res = await fetch('/api/upload-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId,
              chunkIndex,
              totalChunks,
              filename: fileName,
              mimeType,
              dataBase64,
              totalSize
            })
          });

          if (res.ok) {
            lastResult = await res.json();
            if (lastResult?.success) {
              success = true;
            }
          }
        } catch (e) {
          console.warn(`Chunk ${chunkIndex} attempt ${retry + 1} failed:`, e);
        }
        if (!success) {
          retry++;
          await new Promise(r => setTimeout(r, 500 * retry));
        }
      }

      if (!success) {
        throw new Error(`청크 ${chunkIndex + 1}/${totalChunks} 전송에 실패했습니다.`);
      }

      if (onProgress) {
        const pct = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        onProgress(pct);
      }

      if (chunkIndex === totalChunks - 1 && lastResult?.done) {
        return {
          success: true,
          url: lastResult.url,
          filename: lastResult.filename,
          size: lastResult.size || totalSize
        };
      }
    }

    return { success: true, url: `/api/file/${encodeURIComponent(fileId)}`, size: totalSize };
  } catch (err: any) {
    console.error('uploadFileWithChunks error:', err);
    return { success: false, error: err?.message || 'Chunk upload failed' };
  }
}

// Upload a single blob to the server / Redis so mobile devices can access it
export async function uploadBlobToCloud(id: string, name: string, blob: Blob): Promise<boolean> {
  try {
    const res = await uploadFileWithChunks(id, name, blob);
    return res.success;
  } catch (err) {
    console.warn(`Failed to sync blob ${name} to cloud:`, err);
    return false;
  }
}

// Auto-sync all locally stored files in IndexedDB to the cloud
export async function syncAllLocalFilesToCloud(): Promise<{ total: number; synced: number }> {
  try {
    const allFiles = await getAllLocalFileBlobs();
    let synced = 0;
    for (const item of allFiles) {
      if (item.blob && item.blob.size > 0) {
        const ok = await uploadBlobToCloud(item.id, item.name, item.blob);
        if (ok) synced++;
      } else if (item.dataUrl && item.dataUrl.startsWith('data:')) {
        try {
          const res = await fetch(item.dataUrl);
          const blob = await res.blob();
          if (blob && blob.size > 0) {
            const ok = await uploadBlobToCloud(item.id, item.name, blob);
            if (ok) synced++;
          }
        } catch {}
      }
    }
    return { total: allFiles.length, synced };
  } catch (err) {
    console.warn('Sync all local files error:', err);
    return { total: 0, synced: 0 };
  }
}

