import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import redis from "./src/lib/redis.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REDIS_FLOW_KEY = "ajin_flow26_Backup";
const REDIS_INFO_KEY = "ajin_info26";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit to 50MB for file uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // Dedicated File Upload Endpoint
  app.post("/api/upload-file", async (req, res) => {
    try {
      const { filename, base64 } = req.body;
      if (!filename || !base64) {
        return res.status(400).json({ error: "Filename and base64 content required" });
      }

      // Remove base64 data URL prefix if present
      const cleanBase64 = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      // Create a unique safe filename
      const timestamp = Date.now();
      const sanitizedName = filename.replace(/[^a-zA-Z0-9._가-힣-]/g, '_');
      const savedFileName = `${timestamp}_${sanitizedName}`;
      const filePath = path.join(uploadsDir, savedFileName);

      await fs.promises.writeFile(filePath, buffer);

      const fileUrl = `/uploads/${encodeURIComponent(savedFileName)}`;
      res.json({
        success: true,
        url: fileUrl,
        filename: savedFileName,
        originalName: filename,
        size: buffer.length
      });
    } catch (error: any) {
      console.error("File upload error:", error);
      res.status(500).json({ error: error.message || "Failed to upload file" });
    }
  });

  // API routes
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
        // Fallback backward compatibility if infoProjects were previously in flowData
        infoProjectsList = flowData.infoProjects;
      }

      res.json({
        users: flowData.users || defaults.users,
        projects: flowData.projects || defaults.projects,
        processes: flowData.processes || defaults.processes,
        tasks: flowData.tasks || defaults.tasks,
        processParts: flowData.processParts || defaults.processParts,
        infoProjects: infoProjectsList
      });
    } catch (error: any) {
      console.error("Redis fetch error:", error);
      res.status(500).json({ error: "Failed to fetch data from Redis" });
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

      const infoPayload = data.infoProjects || [];

      // Save both to their dedicated keys in Upstash Redis
      await Promise.all([
        redis.set(REDIS_FLOW_KEY, flowPayload),
        redis.set(REDIS_INFO_KEY, infoPayload)
      ]);

      res.json({ success: true });
    } catch (error) {
      console.error("Redis save error:", error);
      res.status(500).json({ error: "Failed to save data to Redis" });
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
