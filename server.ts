import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import redis from "./src/lib/redis.ts";
import { uploadToR2, deleteFromR2, getFromR2 } from "./src/lib/r2Server.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_REDIS_KEY = "ajin_flow26_Backup";
const INFO_REDIS_KEY = "ajin-info-files26";

// Ensure local upload folders exist as fallback
const UPLOADS_BASE = path.join(process.cwd(), "uploads");
const FOLDERS = ["info-pdf", "info-excel", "info-image"];

for (const folder of FOLDERS) {
  const dir = path.join(UPLOADS_BASE, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support large base64 file payloads up to 100MB
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      env: process.env.NODE_ENV,
      redisConfigured: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      r2Configured: Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID),
    });
  });

  // --- INFO DATA API (ajin-info-files26) ---
  app.get("/api/info-data", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.json({
        projects: [],
        files: [],
        warning: "Redis configuration missing. Using local state.",
      });
    }
    try {
      const data: any = await redis.get(INFO_REDIS_KEY);
      const defaults = {
        projects: [],
        files: [],
      };

      if (!data) {
        return res.json(defaults);
      }

      res.json({
        ...defaults,
        ...data,
      });
    } catch (error: any) {
      console.error("Redis fetch error for info-data:", error);
      res.status(500).json({ error: "Failed to fetch info data from Redis" });
    }
  });

  app.post("/api/info-data", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.json({ success: true, warning: "Redis not configured. Saved locally in memory." });
    }
    try {
      const data = req.body;
      await redis.set(INFO_REDIS_KEY, data);
      res.json({ success: true });
    } catch (error) {
      console.error("Redis save error for info-data:", error);
      res.status(500).json({ error: "Failed to save info data to Redis" });
    }
  });

  // --- FLOW DATA API (ajin_flow26_Backup) ---
  app.get("/api/data", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.json({
        users: [],
        projects: [],
        processes: [],
        tasks: [],
        processParts: [],
      });
    }
    try {
      const data: any = await redis.get(FLOW_REDIS_KEY);
      const defaults = {
        users: [],
        projects: [],
        processes: [],
        tasks: [],
        processParts: [],
      };

      if (!data) {
        return res.json(defaults);
      }

      res.json({
        ...defaults,
        ...data,
      });
    } catch (error: any) {
      console.error("Redis fetch error for flow-data:", error);
      res.status(500).json({ error: "Failed to fetch flow data from Redis" });
    }
  });

  app.post("/api/data", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.json({ success: true, warning: "Redis not configured." });
    }
    try {
      const data = req.body;
      await redis.set(FLOW_REDIS_KEY, data);
      res.json({ success: true });
    } catch (error) {
      console.error("Redis save error for flow-data:", error);
      res.status(500).json({ error: "Failed to save flow data to Redis" });
    }
  });

  app.post("/api/reset", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: "Redis configuration missing." });
    }
    try {
      await redis.del(FLOW_REDIS_KEY);
      res.json({ success: true });
    } catch (error) {
      console.error("Redis reset error:", error);
      res.status(500).json({ error: "Failed to reset Redis data" });
    }
  });

  // --- DIRECT PRESIGNED URL API (Bypasses server payload limits for 10MB, 20MB, 50MB+ files) ---
  app.post("/api/presign", async (req, res) => {
    try {
      const { fileName, folder, contentType } = req.body;
      if (!fileName || !folder) {
        return res.status(400).json({ error: "Missing required fields: fileName, folder" });
      }

      const validFolders = ["info-pdf", "info-excel", "info-image"];
      const targetFolder = validFolders.includes(folder) ? folder : "info-pdf";
      const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const key = `${targetFolder}/${cleanFileName}`;

      const { getR2PresignedPutUrl } = await import("./src/lib/r2Presign.js").catch(async () => {
        return await import("./src/lib/r2Presign");
      });

      const presignResult = await getR2PresignedPutUrl(targetFolder as any, cleanFileName, contentType);
      if (presignResult) {
        return res.json({
          isDirectR2: true,
          presignedUrl: presignResult.presignedUrl,
          storagePath: key,
          fileUrl: presignResult.fileUrl,
          fileName: cleanFileName,
          folder: targetFolder,
        });
      }

      return res.json({
        isDirectR2: false,
        message: "R2 presigned URL not available; fallback to local upload",
      });
    } catch (e: any) {
      console.error("Presign error:", e);
      return res.status(500).json({ error: e?.message || "Failed to generate presigned URL" });
    }
  });

  // --- SYNC / SCAN R2 STORAGE API ---
  app.get("/api/sync-r2", async (req, res) => {
    try {
      const { listAllR2Objects } = await import("./src/lib/r2Presign.js").catch(async () => {
        return await import("./src/lib/r2Presign");
      });
      const result = await listAllR2Objects();
      return res.json(result);
    } catch (e: any) {
      console.error("Sync R2 error:", e);
      return res.status(500).json({ error: e?.message || "Failed to list R2 objects" });
    }
  });

  // --- FILE UPLOAD API ---
  app.post("/api/upload", async (req, res) => {
    try {
      const { fileName, folder, base64Data, contentType } = req.body;

      if (!fileName || !folder || !base64Data) {
        return res.status(400).json({ error: "Missing required fields: fileName, folder, base64Data" });
      }

      const validFolders = ["info-pdf", "info-excel", "info-image"];
      const targetFolder = validFolders.includes(folder) ? (folder as 'info-pdf' | 'info-excel' | 'info-image') : "info-pdf";

      // Decode base64 buffer
      const pureBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
      const buffer = Buffer.from(pureBase64, "base64");
      const resolvedContentType = contentType || (
        targetFolder === "info-pdf" ? "application/pdf" :
        targetFolder === "info-excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
        "image/jpeg"
      );

      // Save locally to disk
      const localFilePath = path.join(UPLOADS_BASE, targetFolder, fileName);
      fs.writeFileSync(localFilePath, buffer);

      // Upload to Cloudflare R2 bucket "ajin-info-files"
      const r2Result = await uploadToR2(targetFolder, fileName, buffer, resolvedContentType);

      res.json({
        success: true,
        fileName,
        folder: targetFolder,
        storagePath: r2Result.storagePath,
        fileUrl: r2Result.url,
        fileSize: buffer.length,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload file: " + (error?.message || "Unknown error") });
    }
  });

  // --- MULTIPART CHUNKED UPLOAD API (for 10MB, 20MB, 50MB+ without size limit) ---
  app.post("/api/upload-chunk", async (req, res) => {
    try {
      const { action } = req.body;
      const { getR2S3Client } = await import("./src/lib/r2Presign.js").catch(async () => {
        return await import("./src/lib/r2Presign");
      });
      const r2 = getR2S3Client();

      if (!r2) {
        return res.status(400).json({ error: "Cloudflare R2 is not configured" });
      }

      const {
        CreateMultipartUploadCommand,
        UploadPartCommand,
        CompleteMultipartUploadCommand,
        AbortMultipartUploadCommand,
      } = await import("@aws-sdk/client-s3");

      if (action === "start") {
        const { fileName, folder, contentType } = req.body;
        const validFolders = ["info-pdf", "info-excel", "info-image"];
        const targetFolder = validFolders.includes(folder) ? folder : "info-pdf";
        const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const key = `${targetFolder}/${cleanFileName}`;

        const command = new CreateMultipartUploadCommand({
          Bucket: r2.bucket,
          Key: key,
          ContentType: contentType || "application/octet-stream",
        });
        const resp = await r2.client.send(command);
        return res.json({
          uploadId: resp.UploadId,
          key,
          cleanFileName,
          folder: targetFolder,
        });
      }

      if (action === "part") {
        const { uploadId, key, partNumber, base64Chunk } = req.body;
        const pureBase64 = base64Chunk.includes(",") ? base64Chunk.split(",")[1] : base64Chunk;
        const buffer = Buffer.from(pureBase64, "base64");

        const command = new UploadPartCommand({
          Bucket: r2.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: Number(partNumber),
          Body: buffer,
        });
        const resp = await r2.client.send(command);
        return res.json({
          partNumber: Number(partNumber),
          eTag: resp.ETag,
        });
      }

      if (action === "complete") {
        const { uploadId, key, parts, folder, cleanFileName } = req.body;
        const command = new CompleteMultipartUploadCommand({
          Bucket: r2.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p: any) => ({
              PartNumber: p.partNumber,
              ETag: p.eTag,
            })),
          },
        });
        await r2.client.send(command);
        const finalUrl = r2.publicUrl
          ? `${r2.publicUrl.replace(/\/$/, "")}/${key}`
          : `/api/files/${folder}/${encodeURIComponent(cleanFileName)}`;

        return res.json({
          success: true,
          storagePath: key,
          fileUrl: finalUrl,
          fileName: cleanFileName,
        });
      }

      if (action === "abort") {
        const { uploadId, key } = req.body;
        if (uploadId && key) {
          await r2.client.send(
            new AbortMultipartUploadCommand({
              Bucket: r2.bucket,
              Key: key,
              UploadId: uploadId,
            })
          );
        }
        return res.json({ success: true });
      }

      return res.status(400).json({ error: "Invalid action" });
    } catch (e: any) {
      console.error("Upload chunk error:", e);
      return res.status(500).json({ error: e?.message || "Failed to process chunk" });
    }
  });

  // --- DELETE FILE API (From R2 and Local) ---
  app.post("/api/delete-file", async (req, res) => {
    try {
      const { storagePath, folder, fileName } = req.body;
      const targetKey = storagePath || (folder && fileName ? `${folder}/${fileName}` : "");
      if (!targetKey) {
        return res.status(400).json({ error: "Missing storagePath or folder/fileName" });
      }

      const targetFolder = targetKey.split("/")[0] || folder || "info-pdf";
      const targetFileName = targetKey.split("/")[1] || fileName;

      // Delete from local
      const localFilePath = path.join(UPLOADS_BASE, targetFolder, targetFileName);
      if (fs.existsSync(localFilePath)) {
        try {
          fs.unlinkSync(localFilePath);
        } catch (e) {}
      }

      // Delete from R2
      await deleteFromR2(targetFolder, targetFileName);
      return res.json({ success: true, deletedKey: targetKey });
    } catch (e: any) {
      console.error("Delete error:", e);
      return res.status(500).json({ error: e?.message || "Failed to delete" });
    }
  });

  // --- FILE SERVE / GET API ---
  app.get("/api/files/:folder/:fileName", async (req, res) => {
    try {
      const { folder, fileName } = req.params;
      const decodedFileName = decodeURIComponent(fileName);
      const localFilePath = path.join(UPLOADS_BASE, folder, decodedFileName);

      // Determine content-type
      const ext = path.extname(decodedFileName).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".pdf") contentType = "application/pdf";
      else if (ext === ".xlsx") contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      else if (ext === ".xls") contentType = "application/vnd.ms-excel";
      else if (ext === ".csv") contentType = "text/csv; charset=utf-8";
      else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".webp") contentType = "image/webp";
      else if (ext === ".gif") contentType = "image/gif";

      // If exists locally, serve it
      if (fs.existsSync(localFilePath)) {
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(decodedFileName)}"`);
        return fs.createReadStream(localFilePath).pipe(res);
      }

      // Otherwise try fetching from R2
      const r2Object = await getFromR2(folder, decodedFileName);
      if (r2Object && r2Object.Body) {
        res.setHeader("Content-Type", r2Object.ContentType || contentType);
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(decodedFileName)}"`);
        if (r2Object.ContentLength) {
          res.setHeader("Content-Length", r2Object.ContentLength);
        }
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

        const body = r2Object.Body as any;
        if (typeof body.pipe === "function") {
          return body.pipe(res);
        } else if (typeof body.transformToByteArray === "function") {
          const bytes = await body.transformToByteArray();
          return res.send(Buffer.from(bytes));
        } else {
          return res.send(body);
        }
      }

      return res.status(404).json({ error: "File not found" });
    } catch (error: any) {
      console.error("File serve error:", error);
      res.status(500).json({ error: "Failed to fetch file" });
    }
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
