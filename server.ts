import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import redis from "./src/lib/redis.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REDIS_KEY = "ajin_flow26_Backup";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // API routes
  app.get("/api/data", async (req, res) => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ 
        error: "Redis configuration missing. Please set KV_REST_API_URL and KV_REST_API_TOKEN in settings." 
      });
    }
    try {
      const data: any = await redis.get(REDIS_KEY);
      const defaults = {
        users: [],
        projects: [],
        processes: [],
        tasks: [],
        processParts: []
      };
      
      if (!data) {
        return res.json(defaults);
      }

      // Merge with defaults to ensure all arrays exist
      res.json({
        ...defaults,
        ...data
      });
    } catch (error: any) {
      console.error("Redis fetch error:", error);
      if (error?.message?.includes('WRONGTYPE')) {
        const actualType = await redis.type(REDIS_KEY).catch(() => 'unknown');
        return res.status(500).json({ 
          error: `Redis key "${REDIS_KEY}" holds the wrong data type (${actualType}). Please delete or rename this key in your Upstash console and try again.` 
        });
      }
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
      await redis.set(REDIS_KEY, data);
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
      await redis.del(REDIS_KEY);
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
