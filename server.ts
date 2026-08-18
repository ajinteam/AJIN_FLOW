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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS & Preflight handling
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-File-Name");
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
      try { rawName = decodeURIComponent(rawName); } catch {}

      const cleanName = cleanAndSafeFilename(rawName);
      const timestamp = Date.now();
      const savedFileName = `${timestamp}_${cleanName}`;
      const filePath = path.join(uploadsDir, savedFileName);

      const writeStream = fs.createWriteStream(filePath);
      req.pipe(writeStream);

      writeStream.on('finish', () => {
        try {
          const stats = fs.statSync(filePath);
          const fileUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
          return res.json({
            success: true,
            url: fileUrl,
            filename: savedFileName,
            originalName: cleanName,
            size: stats.size
          });
        } catch (e: any) {
          return res.json({
            success: true,
            url: `/uploads/${encodeURIComponent(savedFileName)}`,
            filename: savedFileName,
            originalName: cleanName,
            size: 0
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

  // Serve uploaded files explicitly with Unicode and UTF-8 header support
  app.get('/uploads/:filename', (req, res) => {
    try {
      const rawParam = req.params.filename;
      let decodedFilename = rawParam;
      try {
        decodedFilename = decodeURIComponent(rawParam);
      } catch {}

      // Try decoded filename first, then rawParam
      let targetPath = path.join(uploadsDir, decodedFilename);
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(uploadsDir, rawParam);
      }

      // If not exact match, search folder for timestamp-matched or sanitized file
      if (!fs.existsSync(targetPath)) {
        const files = fs.readdirSync(uploadsDir);
        const match = files.find(f => f === decodedFilename || f === rawParam || encodeURIComponent(f) === rawParam);
        if (match) {
          targetPath = path.join(uploadsDir, match);
        }
      }

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
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
        }
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(targetPath))}`);
        return res.sendFile(targetPath);
      }

      // If not found in uploads folder, return JSON 404 instead of HTML SPA fallback
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
      // 1. Multipart/form-data upload via Multer
      if (req.file) {
        const cleanName = cleanAndSafeFilename(req.file.originalname);
        const fileUrl = `/uploads/${encodeURIComponent(req.file.filename)}`;
        return res.json({
          success: true,
          url: fileUrl,
          filename: req.file.filename,
          originalName: cleanName,
          size: req.file.size
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

        const fileUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
        return res.json({
          success: true,
          url: fileUrl,
          filename: savedFileName,
          originalName: filename,
          size: buffer.length
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
  app.get("/api/data", async (req, res) => {
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

  app.post("/api/data", async (req, res) => {
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

      // Sanitize infoProjects: Convert any large base64 dataUrl into local file URLs to keep Redis ultra-lightweight (< 50KB)
      let infoProjectsList = Array.isArray(data.infoProjects) ? data.infoProjects : [];
      infoProjectsList = await Promise.all(infoProjectsList.map(async (project: any) => {
        if (!project.files || !Array.isArray(project.files)) return project;
        
        const cleanFiles = await Promise.all(project.files.map(async (file: any) => {
          let sanitizedFile = { ...file };

          // Convert dataUrl if base64 to server file
          if (sanitizedFile.dataUrl && typeof sanitizedFile.dataUrl === 'string' && sanitizedFile.dataUrl.startsWith('data:')) {
            try {
              const cleanBase64 = sanitizedFile.dataUrl.replace(/^data:.*?;base64,/, '');
              const buffer = Buffer.from(cleanBase64, 'base64');
              const timestamp = Date.now();
              const cleanName = cleanAndSafeFilename(sanitizedFile.name || 'file');
              const savedFileName = `${timestamp}_${cleanName}`;
              const filePath = path.join(uploadsDir, savedFileName);
              await fs.promises.writeFile(filePath, buffer);
              sanitizedFile.dataUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
            } catch (convErr) {
              console.warn('Failed to convert base64 to file:', convErr);
            }
          }

          // Strip any large base64 sheetImages or save them to disk
          if (sanitizedFile.sheetImages && Array.isArray(sanitizedFile.sheetImages)) {
            const cleanSheetImages = await Promise.all(sanitizedFile.sheetImages.map(async (si: any, sIdx: number) => {
              if (si.dataUrl && typeof si.dataUrl === 'string' && si.dataUrl.startsWith('data:')) {
                try {
                  const cleanBase64 = si.dataUrl.replace(/^data:.*?;base64,/, '');
                  const buffer = Buffer.from(cleanBase64, 'base64');
                  const timestamp = Date.now();
                  const cleanSheetName = cleanAndSafeFilename(si.name || 'sheet');
                  const savedImgName = `${timestamp}_sheet_${sIdx}_${cleanSheetName}.jpg`;
                  const imgPath = path.join(uploadsDir, savedImgName);
                  await fs.promises.writeFile(imgPath, buffer);
                  return { name: si.name, dataUrl: `/uploads/${encodeURIComponent(savedImgName)}` };
                } catch {
                  return { name: si.name, dataUrl: '' };
                }
              }
              return si;
            }));
            sanitizedFile.sheetImages = cleanSheetImages;
          }

          return sanitizedFile;
        }));

        return {
          ...project,
          files: cleanFiles
        };
      }));

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
