import express, { type Express } from "express";
import path from "path";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import { MAX_SOURCE_BYTES, processVideoJob } from "./videoEditing";

function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "source-video.mp4";
}

function appearsToBeVideo(data: Buffer) {
  if (data.length < 4) return false;
  const fourCc = data.subarray(0, 4).toString("ascii");
  const ftyp = data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  const ogg = fourCc === "OggS";
  const avi = fourCc === "RIFF" && data.length >= 12 && data.subarray(8, 12).toString("ascii") === "AVI ";
  const transportStream = data[0] === 0x47;
  return ftyp || webm || ogg || avi || transportStream;
}

export function registerVideoRoutes(app: Express) {
  app.post("/api/video-upload", express.raw({ type: "*/*", limit: `${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)}mb` }), async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "A video file is required" });
      if (req.body.length > MAX_SOURCE_BYTES) return res.status(413).json({ error: "Video exceeds the 180 MB upload limit" });
      const fileName = safeFileName(String(req.header("x-file-name") ?? "source-video.mp4"));
      const mimeType = String(req.header("x-file-type") ?? req.header("content-type") ?? "video/mp4");
      if (!mimeType.startsWith("video/")) return res.status(415).json({ error: "Please upload a video file" });
      if (!appearsToBeVideo(req.body)) return res.status(415).json({ error: "The uploaded file does not contain a supported video signature" });
      const stored = await storagePut(`users/${user.id}/video-editor/sources/${fileName}`, req.body, mimeType);
      const project = await db.createVideoProject({
        userId: user.id,
        title: path.parse(fileName).name.slice(0, 255),
        sourceFileName: fileName,
        sourceStorageKey: stored.key,
        sourceUrl: stored.url,
        sourceMimeType: mimeType,
        sourceBytes: req.body.length,
      });
      return res.status(201).json({ project });
    } catch (error) {
      console.error("[Video] Upload failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to upload video" });
    }
  });

  app.post("/api/video-jobs/:jobId/process", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!/^job_[a-zA-Z0-9_-]{8,64}$/.test(req.params.jobId)) return res.status(400).json({ error: "Invalid editing job" });
      const queuedJob = await db.getEditJobForUser(req.params.jobId, user.id);
      if (!queuedJob) return res.status(404).json({ error: "Editing job was not found" });
      if (queuedJob.status === "complete" || queuedJob.status === "failed") return res.json({ job: queuedJob });
      void processVideoJob(req.params.jobId, user.id).catch(error => console.error("[Video] Background processing failed", error));
      return res.status(202).json({ job: queuedJob });
    } catch (error) {
      console.error("[Video] Processing failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Video processing failed" });
    }
  });
}
