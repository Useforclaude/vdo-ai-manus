import { and, asc, desc, eq, gt, inArray, isNull, like, lt, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import {
  editJobs,
  InsertEditJob,
  InsertSubtitlePreset,
  InsertUser,
  InsertVideoClip,
  InsertVideoProject,
  InsertVideoUploadPart,
  InsertVideoUploadSession,
  subtitlePresets,
  users,
  videoClips,
  videoProjects,
  videoUploadParts,
  videoUploadSessions,
  mcpAccessTokens,
  mcpAuditLogs,
  systemSettings,
  systemAlerts,
  systemHealthChecks,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("Database is unavailable");
  return db;
}

export async function getSystemSetting(key: string) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0];
}

export async function upsertSystemSetting(key: string, encryptedValue: string) {
  const db = requireDb(await getDb());
  await db.insert(systemSettings).values({ key, encryptedValue }).onDuplicateKeyUpdate({
    set: { encryptedValue },
  });
  return getSystemSetting(key);
}

export async function pingDatabase(): Promise<void> {
  const db = requireDb(await getDb());
  await db.execute("SELECT 1");
}

type RecordedHealth = {
  id: "mysql" | "storage" | "ai";
  label: string;
  status: "healthy" | "degraded" | "unconfigured";
  detail: string;
  checkedAt: Date;
};

export async function recordSystemHealthChecks(results: RecordedHealth[]): Promise<void> {
  const db = requireDb(await getDb());
  await db.transaction(async tx => {
    for (const result of results) {
      const detail = result.detail.slice(0, 1000);
      await tx.insert(systemHealthChecks).values({
        service: result.id,
        status: result.status,
        detail,
        checkedAt: result.checkedAt,
      });
      const active = await tx.select().from(systemAlerts).where(and(
        eq(systemAlerts.service, result.id),
        eq(systemAlerts.state, "open"),
      )).orderBy(desc(systemAlerts.lastDetectedAt)).limit(1);
      if (result.status === "degraded") {
        const summary = `${result.label} connection degraded`;
        if (active[0]) {
          await tx.update(systemAlerts).set({ summary, detail, lastDetectedAt: result.checkedAt }).where(eq(systemAlerts.id, active[0].id));
        } else {
          await tx.insert(systemAlerts).values({
            service: result.id,
            state: "open",
            summary,
            detail,
            firstDetectedAt: result.checkedAt,
            lastDetectedAt: result.checkedAt,
          });
        }
      } else if (active[0]) {
        await tx.update(systemAlerts).set({ state: "resolved", resolvedAt: result.checkedAt }).where(eq(systemAlerts.id, active[0].id));
      }
    }
  });
}

export async function listRecentSystemHealthChecks(limit = 36) {
  const db = requireDb(await getDb());
  return db.select().from(systemHealthChecks).orderBy(desc(systemHealthChecks.checkedAt)).limit(Math.max(1, Math.min(limit, 180)));
}

export async function listSystemAlerts(limit = 30) {
  const db = requireDb(await getDb());
  return db.select().from(systemAlerts).orderBy(desc(systemAlerts.lastDetectedAt)).limit(Math.max(1, Math.min(limit, 100)));
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod", "role"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] as never;
      updateSet[field] = user[field];
    }
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOrCreateGuestUser(guestToken: string) {
  const openId = `guest:${guestToken}`;
  const db = requireDb(await getDb());
  const now = new Date();
  await db.insert(users).values({
    openId,
    name: "Cineflow guest",
    loginMethod: "guest",
    role: "user",
    lastSignedIn: now,
  }).onDuplicateKeyUpdate({ set: { lastSignedIn: now } });
  const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!rows[0]) throw new Error("Unable to create guest session");
  return rows[0];
}

export async function userOwnsStorageKey(userId: number, storageKey: string): Promise<boolean> {
  const db = requireDb(await getDb());
  const [project] = await db.select({ id: videoProjects.id }).from(videoProjects).where(and(
    eq(videoProjects.userId, userId),
    isNull(videoProjects.deletedAt),
    eq(videoProjects.sourceStorageKey, storageKey),
  )).limit(1);
  if (project) return true;
  const [clip] = await db.select({ id: videoClips.id }).from(videoClips).where(and(
    eq(videoClips.userId, userId), eq(videoClips.storageKey, storageKey),
  )).limit(1);
  if (clip) return true;
  const [job] = await db.select({ id: editJobs.id }).from(editJobs).where(and(
    eq(editJobs.userId, userId),
    isNull(editJobs.deletedAt),
    or(eq(editJobs.processedStorageKey, storageKey), eq(editJobs.subtitleStorageKey, storageKey)),
  )).limit(1);
  return Boolean(job);
}

export async function createVideoProject(values: InsertVideoProject) {
  const db = requireDb(await getDb());
  const result = await db.insert(videoProjects).values(values);
  const created = await db.select().from(videoProjects).where(eq(videoProjects.id, Number(result[0].insertId))).limit(1);
  return created[0];
}

export async function getVideoProjectForUser(projectId: number, userId: number) {
  const db = requireDb(await getDb());
  const now = new Date();
  const rows = await db.select().from(videoProjects).where(and(
    eq(videoProjects.id, projectId),
    eq(videoProjects.userId, userId),
    isNull(videoProjects.deletedAt),
    or(isNull(videoProjects.expiresAt), gt(videoProjects.expiresAt, now)),
  )).limit(1);
  return rows[0];
}

export async function listProjectsForUser(userId: number, search?: string) {
  const db = requireDb(await getDb());
  const now = new Date();
  const query = search?.trim();
  return db.select().from(videoProjects).where(and(
    eq(videoProjects.userId, userId),
    isNull(videoProjects.deletedAt),
    or(isNull(videoProjects.expiresAt), gt(videoProjects.expiresAt, now)),
    query ? like(videoProjects.title, `%${query}%`) : undefined,
  )).orderBy(desc(videoProjects.updatedAt));
}

export async function renameVideoProject(projectId: number, userId: number, title: string) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  await db.update(videoProjects).set({ title }).where(and(
    eq(videoProjects.id, projectId),
    eq(videoProjects.userId, userId),
    isNull(videoProjects.deletedAt),
  ));
  return getVideoProjectForUser(projectId, userId);
}

export async function duplicateVideoProject(projectId: number, userId: number, title: string) {
  const sourceProject = await getVideoProjectForUser(projectId, userId);
  if (!sourceProject) return undefined;
  const sourceClips = await listVideoClips(projectId, userId);
  if (!sourceClips.length) return undefined;
  const db = requireDb(await getDb());
  let duplicateId: number | undefined;

  await db.transaction(async tx => {
    const result = await tx.insert(videoProjects).values({
      userId,
      title,
      sourceFileName: sourceProject.sourceFileName,
      sourceStorageKey: sourceProject.sourceStorageKey,
      sourceUrl: sourceProject.sourceUrl,
      sourceMimeType: sourceProject.sourceMimeType,
      sourceBytes: sourceProject.sourceBytes,
      durationSeconds: sourceProject.durationSeconds,
      expiresAt: sourceProject.expiresAt,
    });
    duplicateId = Number(result[0].insertId);
    await tx.insert(videoClips).values(sourceClips.map(clip => ({
      projectId: duplicateId!,
      userId,
      sortOrder: clip.sortOrder,
      originalName: clip.originalName,
      mimeType: clip.mimeType,
      sizeBytes: clip.sizeBytes,
      storageKey: clip.storageKey,
      storageUrl: clip.storageUrl,
      trimStartMs: clip.trimStartMs,
      trimEndMs: clip.trimEndMs,
    })));
  });

  if (!duplicateId) throw new Error("Unable to duplicate the video project");
  return getVideoProjectForUser(duplicateId, userId);
}

export async function createVideoClip(values: InsertVideoClip) {
  const db = requireDb(await getDb());
  const result = await db.insert(videoClips).values(values);
  const rows = await db.select().from(videoClips).where(eq(videoClips.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function createVideoUploadSession(values: InsertVideoUploadSession) {
  const db = requireDb(await getDb());
  await db.insert(videoUploadSessions).values(values);
  return getVideoUploadSessionForUser(values.id, values.userId);
}

export async function getVideoUploadSessionForUser(sessionId: string, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(videoUploadSessions).where(and(
    eq(videoUploadSessions.id, sessionId),
    eq(videoUploadSessions.userId, userId),
    gt(videoUploadSessions.expiresAt, new Date()),
  )).limit(1);
  return rows[0];
}

export async function saveVideoUploadPart(values: InsertVideoUploadPart) {
  const db = requireDb(await getDb());
  const existing = await db.select().from(videoUploadParts).where(and(
    eq(videoUploadParts.sessionId, values.sessionId),
    eq(videoUploadParts.partIndex, values.partIndex),
  )).limit(1);
  if (existing[0]) {
    await db.update(videoUploadParts).set({ storageKey: values.storageKey, sizeBytes: values.sizeBytes }).where(eq(videoUploadParts.id, existing[0].id));
    return { ...existing[0], storageKey: values.storageKey, sizeBytes: values.sizeBytes };
  }
  const result = await db.insert(videoUploadParts).values(values);
  const rows = await db.select().from(videoUploadParts).where(eq(videoUploadParts.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function listVideoUploadParts(sessionId: string) {
  const db = requireDb(await getDb());
  return db.select().from(videoUploadParts).where(eq(videoUploadParts.sessionId, sessionId)).orderBy(asc(videoUploadParts.partIndex));
}

export async function removeVideoUploadSession(sessionId: string, userId: number) {
  const db = requireDb(await getDb());
  const parts = await listVideoUploadParts(sessionId);
  await db.transaction(async tx => {
    await tx.delete(videoUploadParts).where(eq(videoUploadParts.sessionId, sessionId));
    await tx.delete(videoUploadSessions).where(and(eq(videoUploadSessions.id, sessionId), eq(videoUploadSessions.userId, userId)));
  });
  return parts;
}

export async function listVideoClips(projectId: number, userId: number) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return [];
  const db = requireDb(await getDb());
  return db.select().from(videoClips).where(and(eq(videoClips.projectId, projectId), eq(videoClips.userId, userId))).orderBy(asc(videoClips.sortOrder), asc(videoClips.id));
}

export async function getNextClipSortOrder(projectId: number, userId: number) {
  const clips = await listVideoClips(projectId, userId);
  return clips.length ? Math.max(...clips.map(clip => clip.sortOrder)) + 1 : 0;
}

export async function removeVideoClip(projectId: number, clipId: number, userId: number) {
  const clips = await listVideoClips(projectId, userId);
  if (clips.length <= 1) throw new Error("Keep at least one clip in a project; delete the project instead");
  if (!clips.some(clip => clip.id === clipId)) return false;
  const db = requireDb(await getDb());
  await db.delete(videoClips).where(and(eq(videoClips.id, clipId), eq(videoClips.projectId, projectId), eq(videoClips.userId, userId)));
  const remaining = await db.select().from(videoClips).where(and(eq(videoClips.projectId, projectId), eq(videoClips.userId, userId))).orderBy(asc(videoClips.sortOrder), asc(videoClips.id));
  await db.transaction(async tx => {
    for (let sortOrder = 0; sortOrder < remaining.length; sortOrder += 1) {
      await tx.update(videoClips).set({ sortOrder }).where(eq(videoClips.id, remaining[sortOrder].id));
    }
  });
  return true;
}

export async function reorderVideoClips(projectId: number, userId: number, clipIds: number[]) {
  const clips = await listVideoClips(projectId, userId);
  const expected = new Set(clips.map(clip => clip.id));
  const actual = new Set(clipIds);
  if (clipIds.length !== clips.length || actual.size !== clipIds.length || clipIds.some(id => !expected.has(id))) {
    throw new Error("Clip order must include every clip in the project exactly once");
  }
  const db = requireDb(await getDb());
  await db.transaction(async tx => {
    for (let sortOrder = 0; sortOrder < clipIds.length; sortOrder += 1) {
      await tx.update(videoClips).set({ sortOrder }).where(and(eq(videoClips.id, clipIds[sortOrder]), eq(videoClips.projectId, projectId), eq(videoClips.userId, userId)));
    }
  });
  return listVideoClips(projectId, userId);
}

export async function updateVideoClipTrim(projectId: number, clipId: number, userId: number, trimStartMs: number | null, trimEndMs: number | null) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  await db.update(videoClips).set({ trimStartMs, trimEndMs }).where(and(
    eq(videoClips.id, clipId),
    eq(videoClips.projectId, projectId),
    eq(videoClips.userId, userId),
  ));
  const rows = await db.select().from(videoClips).where(and(
    eq(videoClips.id, clipId),
    eq(videoClips.projectId, projectId),
    eq(videoClips.userId, userId),
  )).limit(1);
  return rows[0];
}

export async function listSubtitlePresetsForUser(userId: number) {
  const db = requireDb(await getDb());
  return db.select().from(subtitlePresets).where(eq(subtitlePresets.userId, userId)).orderBy(desc(subtitlePresets.updatedAt), desc(subtitlePresets.id));
}

export async function getSubtitlePresetForUser(presetId: number, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(subtitlePresets).where(and(eq(subtitlePresets.id, presetId), eq(subtitlePresets.userId, userId))).limit(1);
  return rows[0];
}

export async function createSubtitlePreset(values: InsertSubtitlePreset) {
  const existing = await listSubtitlePresetsForUser(values.userId);
  if (existing.length >= 20) throw new Error("You can save up to 20 custom subtitle presets");
  const db = requireDb(await getDb());
  const result = await db.insert(subtitlePresets).values(values);
  return getSubtitlePresetForUser(Number(result[0].insertId), values.userId);
}

export async function updateSubtitlePreset(presetId: number, userId: number, values: Pick<InsertSubtitlePreset, "name" | "font" | "size" | "position">) {
  const existing = await getSubtitlePresetForUser(presetId, userId);
  if (!existing) return undefined;
  const db = requireDb(await getDb());
  await db.update(subtitlePresets).set(values).where(and(eq(subtitlePresets.id, presetId), eq(subtitlePresets.userId, userId)));
  return getSubtitlePresetForUser(presetId, userId);
}

export async function deleteSubtitlePreset(presetId: number, userId: number) {
  const existing = await getSubtitlePresetForUser(presetId, userId);
  if (!existing) return false;
  const db = requireDb(await getDb());
  await db.delete(subtitlePresets).where(and(eq(subtitlePresets.id, presetId), eq(subtitlePresets.userId, userId)));
  return true;
}

export type McpTokenScope = "read" | "edit" | "render";

function hashMcpToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toPublicMcpToken(token: typeof mcpAccessTokens.$inferSelect) {
  const { tokenHash: _tokenHash, ...safeToken } = token;
  return safeToken;
}

export async function createMcpAccessToken(values: {
  userId: number;
  projectId: number;
  label: string;
  scope: McpTokenScope;
  expiresAt: Date;
}) {
  const project = await getVideoProjectForUser(values.projectId, values.userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  const rawToken = `cfmcp_${randomBytes(30).toString("base64url")}`;
  const result = await db.insert(mcpAccessTokens).values({
    ...values,
    tokenHash: hashMcpToken(rawToken),
  });
  const rows = await db.select().from(mcpAccessTokens).where(eq(mcpAccessTokens.id, Number(result[0].insertId))).limit(1);
  if (!rows[0]) throw new Error("Unable to create MCP access token");
  return { token: rawToken, access: toPublicMcpToken(rows[0]) };
}

export async function listMcpAccessTokensForUser(userId: number, projectId?: number) {
  const db = requireDb(await getDb());
  const tokens = await db.select().from(mcpAccessTokens).where(and(
    eq(mcpAccessTokens.userId, userId),
    projectId ? eq(mcpAccessTokens.projectId, projectId) : undefined,
  )).orderBy(desc(mcpAccessTokens.createdAt));
  return tokens.map(toPublicMcpToken);
}

export async function revokeMcpAccessToken(tokenId: number, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(mcpAccessTokens).where(and(
    eq(mcpAccessTokens.id, tokenId),
    eq(mcpAccessTokens.userId, userId),
    isNull(mcpAccessTokens.revokedAt),
  )).limit(1);
  if (!rows[0]) return false;
  await db.update(mcpAccessTokens).set({ revokedAt: new Date() }).where(and(
    eq(mcpAccessTokens.id, tokenId),
    eq(mcpAccessTokens.userId, userId),
    isNull(mcpAccessTokens.revokedAt),
  ));
  return true;
}

export async function resolveMcpAccessToken(rawToken: string) {
  if (!/^cfmcp_[A-Za-z0-9_-]{30,}$/.test(rawToken)) return undefined;
  const db = requireDb(await getDb());
  const now = new Date();
  const rows = await db.select().from(mcpAccessTokens).where(and(
    eq(mcpAccessTokens.tokenHash, hashMcpToken(rawToken)),
    isNull(mcpAccessTokens.revokedAt),
    gt(mcpAccessTokens.expiresAt, now),
  )).limit(1);
  const token = rows[0];
  if (!token) return undefined;
  const project = await getVideoProjectForUser(token.projectId, token.userId);
  if (!project) return undefined;
  await db.update(mcpAccessTokens).set({ lastUsedAt: now }).where(eq(mcpAccessTokens.id, token.id));
  return { ...toPublicMcpToken(token), userId: token.userId, projectId: token.projectId };
}

export async function createMcpAuditLog(values: {
  userId: number;
  projectId: number;
  tokenId: number;
  toolName: string;
  status: "succeeded" | "rejected" | "failed";
  requestSummary: string;
  resultSummary: string;
}) {
  const db = requireDb(await getDb());
  await db.insert(mcpAuditLogs).values({
    ...values,
    toolName: values.toolName.slice(0, 96),
    requestSummary: values.requestSummary.slice(0, 1000),
    resultSummary: values.resultSummary.slice(0, 1000),
  });
}

export async function listMcpAuditLogsForUser(userId: number, projectId: number, limit = 40) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  return db.select().from(mcpAuditLogs).where(and(
    eq(mcpAuditLogs.userId, userId),
    eq(mcpAuditLogs.projectId, projectId),
  )).orderBy(desc(mcpAuditLogs.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
}

export async function softDeleteProject(projectId: number, userId: number) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  const deletedAt = new Date();
  await db.transaction(async tx => {
    await tx.update(videoProjects).set({ deletedAt, sourceStorageKey: null, sourceUrl: null }).where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, userId), isNull(videoProjects.deletedAt)));
    await tx.update(editJobs).set({ deletedAt, processedStorageKey: null, processedUrl: null, subtitleStorageKey: null, subtitleUrl: null }).where(and(eq(editJobs.projectId, projectId), eq(editJobs.userId, userId), isNull(editJobs.deletedAt)));
    await tx.delete(videoClips).where(and(eq(videoClips.projectId, projectId), eq(videoClips.userId, userId)));
  });
  return { ...project, deletedAt };
}

export async function softDeleteEditJob(jobId: string, userId: number) {
  const job = await getEditJobForUser(jobId, userId);
  if (!job) return undefined;
  const db = requireDb(await getDb());
  const deletedAt = new Date();
  await db.update(editJobs).set({ deletedAt, processedStorageKey: null, processedUrl: null, subtitleStorageKey: null, subtitleUrl: null }).where(and(eq(editJobs.id, jobId), eq(editJobs.userId, userId), isNull(editJobs.deletedAt)));
  return { ...job, deletedAt };
}

export async function setProjectRetention(projectId: number, userId: number, expiresAt: Date | null) {
  const project = await getVideoProjectForUser(projectId, userId);
  if (!project) return undefined;
  const db = requireDb(await getDb());
  await db.update(videoProjects).set({ expiresAt }).where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, userId), isNull(videoProjects.deletedAt)));
  return getVideoProjectForUser(projectId, userId);
}

export async function sweepExpiredProjects(userId?: number) {
  const db = requireDb(await getDb());
  const now = new Date();
  const expiresBeforeNow = and(isNull(videoProjects.deletedAt), lt(videoProjects.expiresAt, now));
  const where = userId === undefined ? expiresBeforeNow : and(expiresBeforeNow, eq(videoProjects.userId, userId));
  const expiredProjectIds = await db.select({ id: videoProjects.id }).from(videoProjects).where(where);
  if (expiredProjectIds.length) {
    await db.transaction(async tx => {
      const ids = expiredProjectIds.map(project => project.id);
      await tx.update(videoProjects).set({ deletedAt: now, sourceStorageKey: null, sourceUrl: null }).where(and(inArray(videoProjects.id, ids), isNull(videoProjects.deletedAt)));
      await tx.update(editJobs).set({ deletedAt: now, processedStorageKey: null, processedUrl: null, subtitleStorageKey: null, subtitleUrl: null }).where(and(inArray(editJobs.projectId, ids), isNull(editJobs.deletedAt)));
      await tx.delete(videoClips).where(inArray(videoClips.projectId, ids));
    });
  }
  return expiredProjectIds.length;
}

export async function updateVideoProjectDuration(projectId: number, userId: number, durationSeconds: number) {
  const db = requireDb(await getDb());
  await db.update(videoProjects).set({ durationSeconds }).where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, userId)));
}

export async function createEditJob(values: InsertEditJob) {
  const db = requireDb(await getDb());
  await db.insert(editJobs).values(values);
  const rows = await db.select().from(editJobs).where(eq(editJobs.id, values.id)).limit(1);
  return rows[0];
}

export async function getEditJobForUser(jobId: string, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(editJobs).where(and(eq(editJobs.id, jobId), eq(editJobs.userId, userId), isNull(editJobs.deletedAt))).limit(1);
  const job = rows[0];
  if (!job) return undefined;
  const project = await getVideoProjectForUser(job.projectId, userId);
  return project ? job : undefined;
}

export async function listEditJobsForUser(userId: number) {
  const db = requireDb(await getDb());
  const projects = await listProjectsForUser(userId);
  if (!projects.length) return [];
  return db.select().from(editJobs).where(and(eq(editJobs.userId, userId), inArray(editJobs.projectId, projects.map(project => project.id)), isNull(editJobs.deletedAt))).orderBy(desc(editJobs.createdAt));
}

export async function updateEditJob(jobId: string, userId: number, values: Partial<InsertEditJob>) {
  const db = requireDb(await getDb());
  await db.update(editJobs).set(values).where(and(eq(editJobs.id, jobId), eq(editJobs.userId, userId), isNull(editJobs.deletedAt)));
  return getEditJobForUser(jobId, userId);
}
