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

// Upload a single blob to the server / Redis so mobile devices can access it
export async function uploadBlobToCloud(id: string, name: string, blob: Blob): Promise<boolean> {
  try {
    const safeName = encodeURIComponent(name);
    const res = await fetch(`/api/upload-raw?filename=${safeName}&fileId=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'x-file-id': id,
        'x-file-name': safeName
      },
      body: blob
    });
    return res.ok;
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

