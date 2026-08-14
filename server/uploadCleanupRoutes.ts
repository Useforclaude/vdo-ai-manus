import type { Express } from "express";
import * as db from "./db";
import { storageDelete } from "./storage";
import { sdk } from "./_core/sdk";

export function registerUploadCleanupRoutes(app: Express) {
  app.post("/api/scheduled/purge-expired-upload-sessions", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const storageKeys = await db.purgeExpiredUploadSessions();
      await Promise.all(storageKeys.map(storageKey => storageDelete(storageKey).catch(error => console.warn("[Video] Scheduled staging cleanup failed", error))));
      return res.json({ ok: true, taskUid: user.taskUid, purgedParts: storageKeys.length });
    } catch (error) {
      console.error("[Video] Scheduled upload cleanup failed", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Unable to purge expired upload sessions",
        context: { url: req.originalUrl },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
