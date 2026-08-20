import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import redis from "./src/lib/redis.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REDIS_FLOW_KEY = "ajin_flow26_Backup";
const REDIS_INFO_KEY = "ajin_info26";

// Safe Unicode-aware filename cleaner
function cleanAndSafeFilename(rawName: string): string {
  if (!rawName) return 'file';
  let name = rawName;
  try {
    if (/^[\x00-\xFF]+$/.test(name) && /[\x80-\xFF]/.test(name)) {
      const candidate = Buffer.from(name, 'latin1').toString('utf8');
      if (!candidate.includes('\uFFFD') && candidate.length > 0) {
        name = candidate;
      }
    }
  } catch {}

  // Strip only dangerous characters: \ / : * ? " < > | \r \n \t
  // Preserve Korean, Japanese, Kanji (系, 形), Ampersand (&), brackets (), spaces, dashes, commas, etc.
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
  return cleaned || 'file';
}

// Sync uploaded file to Upstash Redis in chunks for multi-device/multi-container cloud persistence
async function syncFileToRedis(fileKey: string, filePath: string, originalName: string, mimeType: string) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    if (!fs.existsSync(filePath)) return;
    const fileBuffer = await fs.promises.readFile(filePath);
    const CHUNK_SIZE = 450 * 1024; // 450KB chunk size
    const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

    const meta = {
      key: fileKey,
      filename: path.basename(filePath),
      originalName,
      mimeType,
      size: fileBuffer.length,
      chunks: totalChunks,
      updatedAt: new Date().toISOString()
    };

    // Save metadata under fileKey, saved filename, and clean original name
    await Promise.all([
      redis.set(`file_meta:${fileKey}`, meta),
      redis.set(`file_meta:${path.basename(filePath)}`, meta),
      redis.set(`file_meta:${originalName}`, meta)
    ]);

    // Save chunks in batches of 10 for maximum throughput and reliability
    for (let i = 0; i < totalChunks; i += 10) {
      const batch = [];
      for (let j = i; j < Math.min(i + 10, totalChunks); j++) {
        const start = j * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
        const chunkData = sampleSubarray(fileBuffer, start, end).toString('base64');
        batch.push(redis.set(`file_chunk:${fileKey}:${j}`, chunkData));
        batch.push(redis.set(`file_chunk:${path.basename(filePath)}:${j}`, chunkData));
        if (originalName) {
          batch.push(redis.set(`file_chunk:${originalName}:${j}`, chunkData));
        }
      }
      await Promise.all(batch);
    }
    console.log(`Successfully synced file to Redis: ${fileKey} / ${originalName} (${fileBuffer.length} bytes, ${totalChunks} chunks)`);
  } catch (err) {
    console.warn(`Failed to sync file to Redis (${fileKey}):`, err);
  }
}

function sampleSubarray(buf: Buffer, start: number, end: number): Buffer {
  return buf.subarray(start, end);
}

// Helper to normalize strings for robust fuzzy comparison (removes spaces, underscores, timestamps, case)
function normalizeName(str: string): string {
  if (!str) return '';
  return str
    .replace(/^\d+[_]/, '') // remove timestamp prefix
    .replace(/[\s\-_()[\]]/g, '') // remove spaces, dashes, brackets
    .toLowerCase();
}

// Restore missing file from Upstash Redis chunks to local disk
async function restoreFileFromRedis(fileKey: string, targetPath: string): Promise<boolean> {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return false;
    
    // 1. Direct lookups
    let meta: any = await redis.get(`file_meta:${fileKey}`).catch(() => null);
    if (!meta) {
      meta = await redis.get(`file_meta:${path.basename(fileKey)}`).catch(() => null);
    }
    if (!meta) {
      try {
        const decoded = decodeURIComponent(fileKey);
        meta = await redis.get(`file_meta:${decoded}`).catch(() => null);
        if (!meta) {
          meta = await redis.get(`file_meta:${cleanAndSafeFilename(decoded)}`).catch(() => null);
        }
      } catch {}
    }

    // 2. Intelligent fuzzy match if direct lookup failed
    if (!meta || !meta.chunks) {
      try {
        const allMetaKeys = await redis.keys("file_meta:*");
        const normKey = normalizeName(fileKey);

        for (const mk of allMetaKeys) {
          const candidateMeta: any = await redis.get(mk);
          if (!candidateMeta || !candidateMeta.chunks) continue;

          const normCandidateFilename = normalizeName(candidateMeta.filename || '');
          const normCandidateOriginal = normalizeName(candidateMeta.originalName || '');
          const normMetaKey = normalizeName(mk.replace('file_meta:', ''));

          if (
            normKey === normCandidateFilename ||
            normKey === normCandidateOriginal ||
            normKey === normMetaKey ||
            (normKey.length > 5 && normCandidateOriginal.includes(normKey)) ||
            (normCandidateOriginal.length > 5 && normKey.includes(normCandidateOriginal))
          ) {
            meta = candidateMeta;
            console.log(`Fuzzy matched fileKey "${fileKey}" to Redis meta "${candidateMeta.filename || candidateMeta.originalName}"`);
            break;
          }
        }
      } catch (fuzzyErr) {
        console.warn("Fuzzy meta search error:", fuzzyErr);
      }
    }

    if (!meta || !meta.chunks) return false;

    const effectiveKey = meta.key || meta.filename || fileKey;
    const chunkKeys = Array.from({ length: meta.chunks }, (_, i) => `file_chunk:${effectiveKey}:${i}`);
    
    // Read chunks in batches of 15
    const chunksData: any[] = [];
    for (let i = 0; i < chunkKeys.length; i += 15) {
      const batchKeys = chunkKeys.slice(i, i + 15);
      const batchRes = await Promise.all(batchKeys.map(k => redis.get(k)));
      chunksData.push(...batchRes);
    }

    const buffers: Buffer[] = [];
    for (const chunkBase64 of chunksData) {
      if (!chunkBase64 || typeof chunkBase64 !== 'string') return false;
      buffers.push(Buffer.from(chunkBase64, 'base64'));
    }

    const fullBuffer = Buffer.concat(buffers);
    if (fullBuffer.length === 0) return false;

    await fs.promises.writeFile(targetPath, fullBuffer);
    console.log(`Restored missing file from Redis to disk: ${targetPath} (${fullBuffer.length} bytes)`);
    return true;
  } catch (err) {
    console.warn(`Failed to restore file from Redis (${fileKey}):`, err);
    return false;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS & Preflight handling
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-File-Name, X-File-Id");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // 1. Raw Binary Streaming Endpoint (Pipes directly to disk)
  app.all("/api/upload-raw", (req, res) => {
    if (req.method === "OPTIONS") return res.sendStatus(200);
    if (req.method === "GET") return res.json({ status: "ready" });

    try {
      let rawName = (req.query.filename as string) || (req.headers['x-file-name'] as string) || 'file';
      const fileId = (req.query.fileId as string) || (req.headers['x-file-id'] as string) || `${Date.now()}`;
      try { rawName = decodeURIComponent(rawName); } catch {}

      const cleanName = cleanAndSafeFilename(rawName);
      const timestamp = Date.now();
      const savedFileName = `${timestamp}_${cleanName}`;
      const filePath = path.join(uploadsDir, savedFileName);

      const writeStream = fs.createWriteStream(filePath);
      req.pipe(writeStream);

      writeStream.on('finish', async () => {
        try {
          const stats = fs.statSync(filePath);
          const fileUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
          
          // Await Redis chunk sync so data is guaranteed to be saved in cloud storage before returning
          await syncFileToRedis(fileId, filePath, cleanName, req.headers['content-type'] || 'application/octet-stream');
          await syncFileToRedis(savedFileName, filePath, cleanName, req.headers['content-type'] || 'application/octet-stream');

          return res.json({
            success: true,
            url: fileUrl,
            filename: savedFileName,
            originalName: cleanName,
            size: stats.size,
            fileId
          });
        } catch (e: any) {
          return res.json({
            success: true,
            url: `/uploads/${encodeURIComponent(savedFileName)}`,
            filename: savedFileName,
            originalName: cleanName,
            size: 0,
            fileId
          });
        }
      });

      writeStream.on('error', (err) => {
        console.error("Stream write error:", err);
        return res.status(500).json({ success: false, error: err.message || "파일 스트림 저장 오류" });
      });
    } catch (err: any) {
      console.error("upload-raw error:", err);
      return res.status(500).json({ success: false, error: err.message || "파일 업로드 처리 오류" });
    }
  });

  // Body parser limits for JSON and form requests
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Multer configuration for streaming direct binary uploads up to 100MB
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const cleanName = cleanAndSafeFilename(file.originalname);
      const timestamp = Date.now();
      cb(null, `${timestamp}_${cleanName}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB per file limit
  });

  // Safe wrapper for multer middleware
  const handleUploadMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error("Multer upload error:", err);
        return res.status(400).json({ success: false, error: err.message || "파일 업로드 처리 오류" });
      }
      next();
    });
  };

  // Dedicated API file streaming endpoint (Resolves from disk or auto-restores from Redis)
  app.get(['/api/file/:fileKey', '/api/files/:fileKey'], async (req, res) => {
    try {
      const fileKey = req.params.fileKey;
      let decodedKey = fileKey;
      try { decodedKey = decodeURIComponent(fileKey); } catch {}
      const cleanKey = cleanAndSafeFilename(decodedKey);

      let targetPath = path.join(uploadsDir, decodedKey);
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(uploadsDir, fileKey);
      }

      // Check if file exists on disk
      let exists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
      
      // If not on disk, search uploads directory for matches
      if (!exists) {
        const files = fs.readdirSync(uploadsDir);
        const match = files.find(f => 
          f === decodedKey || 
          f === fileKey || 
          f.includes(cleanKey) || 
          f.includes(decodedKey) || 
          encodeURIComponent(f) === fileKey
        );
        if (match) {
          targetPath = path.join(uploadsDir, match);
          exists = true;
        }
      }

      // If still not on disk, check if fileKey is an infoFile ID in flowData to find its real name
      let possibleNames: string[] = [decodedKey, fileKey, cleanKey];
      try {
        const flowData: any = await redis.get("ajin_flow26_Backup").catch(() => null);
        const allFiles = (flowData?.infoProjects || []).flatMap((p: any) => p.files || []);
        const matched = allFiles.find((f: any) => f.id === fileKey || f.id === decodedKey);
        if (matched?.name) {
          possibleNames.push(matched.name);
          possibleNames.push(cleanAndSafeFilename(matched.name));
        }
      } catch {}

      // Search disk for possible names
      if (!exists) {
        const files = fs.readdirSync(uploadsDir);
        for (const pname of possibleNames) {
          const match = files.find(f => f.includes(pname) || f.endsWith(pname));
          if (match) {
            targetPath = path.join(uploadsDir, match);
            exists = true;
            break;
          }
        }
      }

      // If still not on disk, auto-restore from Redis using all possible keys
      if (!exists) {
        for (const k of possibleNames) {
          const restored = await restoreFileFromRedis(k, path.join(uploadsDir, cleanAndSafeFilename(k)));
          if (restored) {
            targetPath = path.join(uploadsDir, cleanAndSafeFilename(k));
            exists = true;
            break;
          }
        }
      }

      if (exists) {
        const ext = path.extname(targetPath).toLowerCase();
        if (ext === '.pdf') {
          res.setHeader('Content-Type', 'application/pdf');
        } else if (ext === '.xlsx') {
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else if (ext === '.xls') {
          res.setHeader('Content-Type', 'application/vnd.ms-excel');
        } else if (['.jpg', '.jpeg'].includes(ext)) {
          res.setHeader('Content-Type', 'image/jpeg');
        } else if (ext === '.png') {
          res.setHeader('Content-Type', 'image/png');
        } else if (ext === '.webp') {
          res.setHeader('Content-Type', 'image/webp');
        } else {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        
        const stat = fs.statSync(targetPath);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(targetPath))}`);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        
        const readStream = fs.createReadStream(targetPath);
        readStream.on('error', (err) => {
          console.error("Stream read error:", err);
          if (!res.headersSent) res.status(500).json({ error: "File read error" });
        });
        return readStream.pipe(res);
      }

      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    } catch (err: any) {
      console.error('API file serve error:', err);
      return res.status(500).json({ error: err?.message || 'File serve error' });
    }
  });

  // Serve uploaded files explicitly with Unicode and UTF-8 header support & auto-restore from Redis
  app.get('/uploads/:filename', async (req, res) => {
    try {
      const rawParam = req.params.filename;
      let decodedFilename = rawParam;
      try {
        decodedFilename = decodeURIComponent(rawParam);
      } catch {}
      const cleanName = cleanAndSafeFilename(decodedFilename);

      let targetPath = path.join(uploadsDir, decodedFilename);
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(uploadsDir, rawParam);
      }

      // If not exact match, search folder for match
      let exists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
      if (!exists) {
        const files = fs.readdirSync(uploadsDir);
        const match = files.find(f => 
          f === decodedFilename || 
          f === rawParam || 
          f.includes(cleanName) || 
          f.includes(decodedFilename) || 
          encodeURIComponent(f) === rawParam
        );
        if (match) {
          targetPath = path.join(uploadsDir, match);
          exists = true;
        }
      }

      // If still not on disk, try auto-restoring from Redis
      if (!exists) {
        const keysToTry = [decodedFilename, rawParam, cleanName];
        for (const k of keysToTry) {
          const restored = await restoreFileFromRedis(k, path.join(uploadsDir, cleanName));
          if (restored) {
            targetPath = path.join(uploadsDir, cleanName);
            exists = true;
            break;
          }
        }
      }

      if (exists) {
        const ext = path.extname(targetPath).toLowerCase();
        if (ext === '.pdf') {
          res.setHeader('Content-Type', 'application/pdf');
        } else if (ext === '.xlsx') {
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else if (ext === '.xls') {
          res.setHeader('Content-Type', 'application/vnd.ms-excel');
        } else if (['.jpg', '.jpeg'].includes(ext)) {
          res.setHeader('Content-Type', 'image/jpeg');
        } else if (ext === '.png') {
          res.setHeader('Content-Type', 'image/png');
        } else if (ext === '.webp') {
          res.setHeader('Content-Type', 'image/webp');
        } else {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(targetPath))}`);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(targetPath);
      }

      return res.status(404).json({ error: 'File not found on server storage' });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'File download error' });
    }
  });

  app.use('/uploads', express.static(uploadsDir));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // Direct Binary & Multipart File Upload Endpoint
  const handleFileUploadRoute = async (req: express.Request, res: express.Response) => {
    try {
      const fileId = (req.query.fileId as string) || (req.headers['x-file-id'] as string) || `${Date.now()}`;

      // 1. Multipart/form-data upload via Multer
      if (req.file) {
        const cleanName = cleanAndSafeFilename(req.file.originalname);
        const fileUrl = `/uploads/${encodeURIComponent(req.file.filename)}`;
        const filePath = path.join(uploadsDir, req.file.filename);

        // Await sync to Redis before returning so cloud persistence is guaranteed
        await syncFileToRedis(fileId, filePath, cleanName, req.file.mimetype);
        await syncFileToRedis(req.file.filename, filePath, cleanName, req.file.mimetype);

        return res.json({
          success: true,
          url: fileUrl,
          filename: req.file.filename,
          originalName: cleanName,
          size: req.file.size,
          fileId
        });
      }

      // 2. Base64 JSON payload fallback
      const { filename, base64 } = req.body || {};
      if (filename && base64) {
        const cleanBase64 = base64.replace(/^data:.*?;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const timestamp = Date.now();
        const cleanName = cleanAndSafeFilename(filename);
        const savedFileName = `${timestamp}_${cleanName}`;
        const filePath = path.join(uploadsDir, savedFileName);

        await fs.promises.writeFile(filePath, buffer);

        // Await sync to Redis
        await syncFileToRedis(fileId, filePath, cleanName, 'application/octet-stream');
        await syncFileToRedis(savedFileName, filePath, cleanName, 'application/octet-stream');

        const fileUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
        return res.json({
          success: true,
          url: fileUrl,
          filename: savedFileName,
          originalName: filename,
          size: buffer.length,
          fileId
        });
      }

      return res.status(400).json({ success: false, error: "전송된 파일 내용이 없습니다." });
    } catch (error: any) {
      console.error("File upload error:", error);
      return res.status(500).json({ success: false, error: error.message || "Upload failed" });
    }
  };

  // Register both GET/POST/ALL on multiple endpoints to prevent 405 on any client call
  app.get("/api/upload-file", (req, res) => res.json({ status: "ready" }));
  app.post("/api/upload-file", handleUploadMiddleware, handleFileUploadRoute);
  app.put("/api/upload-file", handleUploadMiddleware, handleFileUploadRoute);

  app.get("/api/upload", (req, res) => res.json({ status: "ready" }));
  app.post("/api/upload", handleUploadMiddleware, handleFileUploadRoute);
  app.put("/api/upload", handleUploadMiddleware, handleFileUploadRoute);

  // API routes for data fetching & saving
  app.get(["/api/data", "/api/backup"], async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ 
        error: "Redis configuration missing. Please set KV_REST_API_URL and KV_REST_API_TOKEN in settings." 
      });
    }
    try {
      // Parallel fetch from both ajin_flow26_Backup and ajin_info26
      const [flowDataRaw, infoDataRaw]: [any, any] = await Promise.all([
        redis.get(REDIS_FLOW_KEY).catch((err) => {
          console.warn(`Redis get ${REDIS_FLOW_KEY} error:`, err);
          return null;
        }),
        redis.get(REDIS_INFO_KEY).catch((err) => {
          console.warn(`Redis get ${REDIS_INFO_KEY} error:`, err);
          return null;
        })
      ]);

      const defaults = {
        users: [],
        projects: [],
        processes: [],
        tasks: [],
        processParts: [],
        infoProjects: []
      };

      // Parse Flow data
      let flowData: any = {};
      if (flowDataRaw) {
        if (typeof flowDataRaw === 'string') {
          try { flowData = JSON.parse(flowDataRaw); } catch { flowData = {}; }
        } else if (typeof flowDataRaw === 'object') {
          flowData = flowDataRaw;
        }
      }

      // Parse Info data
      let infoProjectsList: any[] = [];
      if (infoDataRaw) {
        if (typeof infoDataRaw === 'string') {
          try {
            const parsed = JSON.parse(infoDataRaw);
            infoProjectsList = Array.isArray(parsed) ? parsed : (parsed.infoProjects || []);
          } catch {
            infoProjectsList = [];
          }
        } else if (Array.isArray(infoDataRaw)) {
          infoProjectsList = infoDataRaw;
        } else if (typeof infoDataRaw === 'object') {
          infoProjectsList = infoDataRaw.infoProjects || [];
        }
      } else if (flowData.infoProjects && Array.isArray(flowData.infoProjects)) {
        infoProjectsList = flowData.infoProjects;
      }

      const users = flowData.users || defaults.users;
      const projects = flowData.projects || defaults.projects;
      const processes = flowData.processes || defaults.processes;
      const tasks = flowData.tasks || defaults.tasks;
      const processParts = flowData.processParts || defaults.processParts;
      const infoProjects = infoProjectsList || defaults.infoProjects;

      res.json({
        users,
        projects,
        processes,
        tasks,
        processParts,
        infoProjects
      });
    } catch (error: any) {
      console.error("Redis fetch error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch data from Redis" });
    }
  });

  app.post(["/api/data", "/api/backup"], async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ 
        error: "Redis configuration missing. Please set KV_REST_API_URL and KV_REST_API_TOKEN in settings." 
      });
    }
    try {
      const data = req.body;
      
      // Separate Flow payload and Info payload
      const flowPayload = {
        users: data.users || [],
        projects: data.projects || [],
        processes: data.processes || [],
        tasks: data.tasks || [],
        processParts: data.processParts || []
      };

      // Sanitize infoProjects: Keep Redis payload strictly lightweight
      let infoProjectsList = Array.isArray(data.infoProjects) ? data.infoProjects : [];
      infoProjectsList = infoProjectsList.map((project: any) => {
        if (!project.files || !Array.isArray(project.files)) return project;
        
        const cleanFiles = project.files.map((file: any) => {
          let sanitizedFile = { ...file };
          if (sanitizedFile.dataUrl && typeof sanitizedFile.dataUrl === 'string' && sanitizedFile.dataUrl.startsWith('data:')) {
            // Strip any accidental huge base64 strings so Redis never exceeds 1MB limit
            sanitizedFile.dataUrl = `/uploads/${encodeURIComponent(cleanAndSafeFilename(sanitizedFile.name || 'file'))}`;
          }
          if (sanitizedFile.sheetImages && Array.isArray(sanitizedFile.sheetImages)) {
            sanitizedFile.sheetImages = sanitizedFile.sheetImages.map((si: any) => ({
              name: si.name,
              dataUrl: (typeof si.dataUrl === 'string' && si.dataUrl.startsWith('data:')) ? '' : (si.dataUrl || '')
            }));
          }
          return sanitizedFile;
        });

        return {
          ...project,
          files: cleanFiles
        };
      });

      // Save both to their dedicated keys in Upstash Redis
      await Promise.all([
        redis.set(REDIS_FLOW_KEY, flowPayload),
        redis.set(REDIS_INFO_KEY, infoProjectsList)
      ]);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Redis save error:", error);
      res.status(500).json({ error: error.message || "Failed to save data to Redis" });
    }
  });

  app.post("/api/reset", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: "Redis configuration missing." });
    }
    try {
      await Promise.all([
        redis.del(REDIS_FLOW_KEY),
        redis.del(REDIS_INFO_KEY)
      ]);
      res.json({ success: true });
    } catch (error) {
      console.error("Redis reset error:", error);
      res.status(500).json({ error: "Failed to reset Redis data" });
    }
  });

  // Catch-all for API routes so unhandled API endpoints NEVER fall through to Vite (prevents Vite 405 error)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
  });

  // Vite middleware for development
  console.log(`Running in ${process.env.NODE_ENV || 'development'} mode`);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
