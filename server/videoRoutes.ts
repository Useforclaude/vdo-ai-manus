import express, { type Express } from "express";
import path from "path";
import { Readable } from "node:stream";
import * as db from "./db";
import { storageGetSignedUrl, storagePut } from "./storage";
import { MAX_SOURCE_BYTES, processVideoJob } from "./videoEditing";
import { resolveVideoActor } from "./videoActor";

const MAX_CLIPS_PER_PROJECT = 12;

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

type CompletedJobOutput = {
  id: string;
  processedStorageKey?: string | null;
  subtitleStorageKey?: string | null;
};

export function getDownloadAsset(job: CompletedJobOutput, asset: "video" | "subtitle") {
  if (asset === "subtitle") {
    if (!job.subtitleStorageKey) return null;
    return { storageKey: job.subtitleStorageKey, fileName: `cineflow-subtitles-${job.id}.srt`, contentType: "application/x-subrip" };
  }
  if (!job.processedStorageKey) return null;
  return { storageKey: job.processedStorageKey, fileName: `cineflow-edit-${job.id}.mp4`, contentType: "video/mp4" };
}

export function registerVideoRoutes(app: Express) {
  app.post("/api/video-upload", express.raw({ type: "*/*", limit: `${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)}mb` }), async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      await db.sweepExpiredProjects(actor.userId);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "A video file is required" });
      if (req.body.length > MAX_SOURCE_BYTES) return res.status(413).json({ error: "Video exceeds the 180 MB upload limit" });
      const fileName = safeFileName(String(req.header("x-file-name") ?? "source-video.mp4"));
      const mimeType = String(req.header("x-file-type") ?? req.header("content-type") ?? "video/mp4");
      if (!mimeType.startsWith("video/")) return res.status(415).json({ error: "Please upload a video file" });
      if (!appearsToBeVideo(req.body)) return res.status(415).json({ error: "The uploaded file does not contain a supported video signature" });
      const stored = await storagePut(`users/${actor.userId}/video-editor/sources/${fileName}`, req.body, mimeType);
      const project = await db.createVideoProject({
        userId: actor.userId,
        title: path.parse(fileName).name.slice(0, 255),
        sourceFileName: fileName,
        sourceStorageKey: stored.key,
        sourceUrl: stored.url,
        sourceMimeType: mimeType,
        sourceBytes: req.body.length,
      });
      const clip = await db.createVideoClip({
        projectId: project.id,
        userId: actor.userId,
        sortOrder: 0,
        originalName: fileName,
        mimeType,
        sizeBytes: req.body.length,
        storageKey: stored.key,
        storageUrl: stored.url,
      });
      return res.status(201).json({ project, clip });
    } catch (error) {
      console.error("[Video] Upload failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to upload video" });
    }
  });

  app.post("/api/video-projects/:projectId/clips", express.raw({ type: "*/*", limit: `${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)}mb` }), async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      await db.sweepExpiredProjects(actor.userId);
      const projectId = Number(req.params.projectId);
      if (!Number.isSafeInteger(projectId) || projectId < 1) return res.status(400).json({ error: "Invalid video project" });
      const project = await db.getVideoProjectForUser(projectId, actor.userId);
      if (!project) return res.status(404).json({ error: "Video project was not found" });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "A video file is required" });
      if (req.body.length > MAX_SOURCE_BYTES) return res.status(413).json({ error: "Video exceeds the 180 MB upload limit" });
      const fileName = safeFileName(String(req.header("x-file-name") ?? "source-video.mp4"));
      const mimeType = String(req.header("x-file-type") ?? req.header("content-type") ?? "video/mp4");
      if (!mimeType.startsWith("video/")) return res.status(415).json({ error: "Please upload a video file" });
      if (!appearsToBeVideo(req.body)) return res.status(415).json({ error: "The uploaded file does not contain a supported video signature" });
      const clips = await db.listVideoClips(projectId, actor.userId);
      if (clips.length >= MAX_CLIPS_PER_PROJECT) return res.status(422).json({ error: `A project can contain at most ${MAX_CLIPS_PER_PROJECT} clips` });
      const totalBytes = clips.reduce((total, clip) => total + clip.sizeBytes, 0) + req.body.length;
      if (totalBytes > MAX_SOURCE_BYTES) return res.status(413).json({ error: "Combined clips exceed the 180 MB processing limit" });
      const stored = await storagePut(`users/${actor.userId}/video-editor/projects/${projectId}/clips/${fileName}`, req.body, mimeType);
      const clip = await db.createVideoClip({
        projectId,
        userId: actor.userId,
        sortOrder: await db.getNextClipSortOrder(projectId, actor.userId),
        originalName: fileName,
        mimeType,
        sizeBytes: req.body.length,
        storageKey: stored.key,
        storageUrl: stored.url,
      });
      return res.status(201).json({ clip });
    } catch (error) {
      console.error("[Video] Clip upload failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to upload video clip" });
    }
  });

  app.post("/api/video-jobs/:jobId/process", async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      await db.sweepExpiredProjects(actor.userId);
      if (!/^job_[a-zA-Z0-9_-]{8,64}$/.test(req.params.jobId)) return res.status(400).json({ error: "Invalid editing job" });
      const queuedJob = await db.getEditJobForUser(req.params.jobId, actor.userId);
      if (!queuedJob) return res.status(404).json({ error: "Editing job was not found" });
      if (queuedJob.status === "complete" || queuedJob.status === "failed") return res.json({ job: queuedJob });
      void processVideoJob(req.params.jobId, actor.userId).catch(error => console.error("[Video] Background processing failed", error));
      return res.status(202).json({ job: queuedJob });
    } catch (error) {
      console.error("[Video] Processing failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Video processing failed" });
    }
  });

  app.get("/api/video-jobs/:jobId/download", async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      await db.sweepExpiredProjects(actor.userId);
      if (!/^job_[a-zA-Z0-9_-]{8,64}$/.test(req.params.jobId)) return res.status(400).json({ error: "Invalid editing job" });
      const requestedAsset = req.query.asset ?? "video";
      if (requestedAsset !== "video" && requestedAsset !== "subtitle") return res.status(400).json({ error: "Invalid download asset" });

      const job = await db.getEditJobForUser(req.params.jobId, actor.userId);
      if (!job) return res.status(404).json({ error: "Editing job was not found" });
      const output = getDownloadAsset(job, requestedAsset);
      if (!output) return res.status(404).json({ error: "Requested output is not available" });

      const signedUrl = await storageGetSignedUrl(output.storageKey);
      const upstream = await fetch(signedUrl);
      if (!upstream.ok || !upstream.body) throw new Error("Unable to retrieve processed output from storage");

      const contentLength = upstream.headers.get("content-length");
      res.status(200);
      res.setHeader("Content-Type", output.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${output.fileName}"`);
      res.setHeader("Cache-Control", "private, no-store");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).on("error", error => {
        console.error("[Video] Download stream failed", error);
        if (!res.headersSent) res.status(502).json({ error: "Unable to stream processed output" });
        else res.destroy(error);
      }).pipe(res);
    } catch (error) {
      console.error("[Video] Download failed", error);
      if (!res.headersSent) return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to download processed output" });
    }
  });
}
