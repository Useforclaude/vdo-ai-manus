import type { Express } from "express";
import { fileURLToPath } from "node:url";
import * as db from "./db";
import { storageGetSignedUrl } from "./storage";
import { resolveVideoActor } from "./videoActor";

export function registerMediaRoutes(app: Express) {
  app.get("/api/media", async (req, res) => {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (!key || key.length > 1024) return res.status(400).json({ error: "A storage key is required" });
    try {
      const actor = await resolveVideoActor(req, res);
      if (!(await db.userOwnsStorageKey(actor.userId, key))) return res.status(404).json({ error: "Media not found" });
      const location = await storageGetSignedUrl(key);
      if (location.startsWith("file:")) {
        res.type(key);
        return res.sendFile(fileURLToPath(location));
      }
      return res.redirect(302, location);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access media";
      return res.status(500).json({ error: message });
    }
  });
}
