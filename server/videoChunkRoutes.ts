import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as db from "./db";
import { storageDelete, storagePut, storagePutExact, storageRead } from "./storage";
import { MAX_SOURCE_BYTES } from "./videoEditing";
import { resolveVideoActor } from "./videoActor";

export const VIDEO_UPLOAD_PART_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_PARTS = Math.ceil(MAX_SOURCE_BYTES / VIDEO_UPLOAD_PART_BYTES);
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CLIPS_PER_PROJECT = 12;

function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "source-video.mp4";
}

function appearsToBeVideo(data: Buffer) {
  if (data.length < 4) return false;
  const fourCc = data.subarray(0, 4).toString("ascii");
  return (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp")
    || (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3)
    || fourCc === "OggS"
    || (fourCc === "RIFF" && data.length >= 12 && data.subarray(8, 12).toString("ascii") === "AVI ")
    || data[0] === 0x47;
}

async function persistUploadedVideo(input: { userId: number; fileName: string; mimeType: string; data: Buffer; projectId?: number | null }) {
  if (input.data.length === 0) throw new Error("A video file is required");
  if (input.data.length > MAX_SOURCE_BYTES) throw new Error("Video exceeds the 180 MB upload limit");
  if (!input.mimeType.startsWith("video/")) throw new Error("Please upload a video file");
  if (!appearsToBeVideo(input.data)) throw new Error("The uploaded file does not contain a supported video signature");

  if (input.projectId) {
    const project = await db.getVideoProjectForUser(input.projectId, input.userId);
    if (!project) throw new Error("Video project was not found");
    const clips = await db.listVideoClips(input.projectId, input.userId);
    if (clips.length >= MAX_CLIPS_PER_PROJECT) throw new Error(`A project can contain at most ${MAX_CLIPS_PER_PROJECT} clips`);
    if (clips.reduce((total, clip) => total + clip.sizeBytes, 0) + input.data.length > MAX_SOURCE_BYTES) throw new Error("Combined clips exceed the 180 MB processing limit");
    const stored = await storagePut(`users/${input.userId}/video-editor/projects/${input.projectId}/clips/${input.fileName}`, input.data, input.mimeType);
    const clip = await db.createVideoClip({ projectId: input.projectId, userId: input.userId, sortOrder: await db.getNextClipSortOrder(input.projectId, input.userId), originalName: input.fileName, mimeType: input.mimeType, sizeBytes: input.data.length, storageKey: stored.key, storageUrl: stored.url });
    return { clip };
  }

  const stored = await storagePut(`users/${input.userId}/video-editor/sources/${input.fileName}`, input.data, input.mimeType);
  const project = await db.createVideoProject({ userId: input.userId, title: path.parse(input.fileName).name.slice(0, 255), sourceFileName: input.fileName, sourceStorageKey: stored.key, sourceUrl: stored.url, sourceMimeType: input.mimeType, sourceBytes: input.data.length });
  const clip = await db.createVideoClip({ projectId: project.id, userId: input.userId, sortOrder: 0, originalName: input.fileName, mimeType: input.mimeType, sizeBytes: input.data.length, storageKey: stored.key, storageUrl: stored.url });
  return { project, clip };
}

function validUploadId(value: string) {
  return /^upload_[a-f0-9]{32}$/.test(value);
}

async function purgeExpiredUploadStaging() {
  const storageKeys = await db.purgeExpiredUploadSessions();
  await Promise.all(storageKeys.map(storageKey => storageDelete(storageKey).catch(error => console.warn("[Video] Expired staging cleanup failed", error))));
  return storageKeys.length;
}

export function registerVideoChunkRoutes(app: Express) {
  app.post("/api/video-uploads", async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      await db.sweepExpiredProjects(actor.userId);
      await purgeExpiredUploadStaging().catch(error => console.warn("[Video] Expired upload cleanup failed", error));
      const body = req.body as Record<string, unknown>;
      const totalBytes = Number(body?.totalBytes);
      const totalParts = Number(body?.totalParts);
      const requestedProjectId = body?.projectId === undefined ? undefined : Number(body.projectId);
      const fileName = safeFileName(String(body?.fileName ?? "source-video.mp4"));
      const mimeType = String(body?.mimeType ?? "video/mp4");
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_SOURCE_BYTES) return res.status(413).json({ error: "Video must be between 1 byte and 180 MB" });
      if (!Number.isSafeInteger(totalParts) || totalParts < 1 || totalParts > MAX_UPLOAD_PARTS || totalParts !== Math.ceil(totalBytes / VIDEO_UPLOAD_PART_BYTES)) return res.status(400).json({ error: "Invalid upload part count" });
      if (!mimeType.startsWith("video/")) return res.status(415).json({ error: "Please upload a video file" });
      if (requestedProjectId !== undefined && (!Number.isSafeInteger(requestedProjectId) || requestedProjectId < 1 || !await db.getVideoProjectForUser(requestedProjectId, actor.userId))) return res.status(404).json({ error: "Video project was not found" });
      const session = await db.createVideoUploadSession({ id: `upload_${randomUUID().replace(/-/g, "")}`, userId: actor.userId, projectId: requestedProjectId, fileName, mimeType, totalBytes, totalParts, expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS) });
      return res.status(201).json({ uploadId: session?.id, partBytes: VIDEO_UPLOAD_PART_BYTES });
    } catch (error) {
      console.error("[Video] Upload session start failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to start upload" });
    }
  });

  app.put("/api/video-uploads/:sessionId/parts/:partIndex", express.raw({ type: "application/octet-stream", limit: "5mb" }), async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      const partIndex = Number(req.params.partIndex);
      if (!validUploadId(req.params.sessionId) || !Number.isSafeInteger(partIndex) || partIndex < 0) return res.status(400).json({ error: "Invalid upload part" });
      const session = await db.getVideoUploadSessionForUser(req.params.sessionId, actor.userId);
      if (!session) return res.status(404).json({ error: "Upload session was not found or expired" });
      if (partIndex >= session.totalParts || !Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "Invalid upload part" });
      const expectedBytes = partIndex === session.totalParts - 1 ? session.totalBytes - partIndex * VIDEO_UPLOAD_PART_BYTES : VIDEO_UPLOAD_PART_BYTES;
      if (req.body.length !== expectedBytes) return res.status(400).json({ error: "Upload part has an unexpected size" });
      const storageKey = await storagePutExact(`users/${actor.userId}/video-editor/staging/${session.id}/${partIndex}.part`, req.body);
      await db.saveVideoUploadPart({ sessionId: session.id, partIndex, storageKey, sizeBytes: req.body.length });
      return res.status(201).json({ received: partIndex });
    } catch (error) {
      console.error("[Video] Upload part failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to receive upload part" });
    }
  });

  app.post("/api/video-uploads/:sessionId/complete", async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      if (!validUploadId(req.params.sessionId)) return res.status(400).json({ error: "Invalid upload session" });
      const session = await db.getVideoUploadSessionForUser(req.params.sessionId, actor.userId);
      if (!session) return res.status(404).json({ error: "Upload session was not found or expired" });
      const parts = await db.listVideoUploadParts(session.id);
      if (parts.length !== session.totalParts || parts.some((part, index) => part.partIndex !== index)) return res.status(409).json({ error: "Upload is incomplete; retry the missing part" });
      if (parts.reduce((total, part) => total + part.sizeBytes, 0) !== session.totalBytes) return res.status(400).json({ error: "Upload size verification failed" });
      const data = Buffer.concat(await Promise.all(parts.map(part => storageRead(part.storageKey))));
      const result = await persistUploadedVideo({ userId: actor.userId, fileName: session.fileName, mimeType: session.mimeType, data, projectId: session.projectId });
      const stagingParts = await db.removeVideoUploadSession(session.id, actor.userId);
      await Promise.all(stagingParts.map(part => storageDelete(part.storageKey).catch(error => console.warn("[Video] Staging cleanup failed", error))));
      return res.status(201).json(result);
    } catch (error) {
      console.error("[Video] Upload completion failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to complete upload" });
    }
  });

  app.delete("/api/video-uploads/:sessionId", async (req, res) => {
    try {
      const actor = await resolveVideoActor(req, res);
      if (!validUploadId(req.params.sessionId)) return res.status(400).json({ error: "Invalid upload session" });
      const stagingParts = await db.cancelVideoUploadSession(req.params.sessionId, actor.userId);
      await Promise.all(stagingParts.map(part => storageDelete(part.storageKey).catch(error => console.warn("[Video] Cancel cleanup failed", error))));
      return res.status(200).json({ cancelled: true, removedParts: stagingParts.length });
    } catch (error) {
      console.error("[Video] Upload cancellation failed", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to cancel upload" });
    }
  });
}
