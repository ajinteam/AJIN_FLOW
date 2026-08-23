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

  // --- FILE DELETE API ---
  app.delete("/api/files/:folder/:fileName", async (req, res) => {
    try {
      const { folder, fileName } = req.params;
      const decodedFileName = decodeURIComponent(fileName);

      // Delete from local disk
      const localFilePath = path.join(UPLOADS_BASE, folder, decodedFileName);
      if (fs.existsSync(localFilePath)) {
        try {
          fs.unlinkSync(localFilePath);
        } catch (e) {
          console.warn("Could not delete local file:", e);
        }
      }

      // Delete from Cloudflare R2
      await deleteFromR2(folder, decodedFileName);

      res.json({ success: true, message: `File ${folder}/${decodedFileName} deleted successfully` });
    } catch (error: any) {
      console.error("File delete error:", error);
      res.status(500).json({ error: "Failed to delete file" });
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
        const stream = r2Object.Body as any;
        return stream.pipe(res);
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
