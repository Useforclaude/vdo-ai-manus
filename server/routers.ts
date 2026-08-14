import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { GUEST_COOKIE_NAME } from "./videoActor";
import { createJobId, interpretVideoCommand, previewClipSilences } from "./videoEditing";
import { resolveVideoActor } from "./videoActor";
import { subtitleStyleForPreset } from "@shared/subtitles";
import { createAiProducerDraft, listAiProducerModels } from "./aiProducer";
import {
  getPublicProviderConfiguration,
  getRuntimeProviderConfig,
  isAdminSession,
  lockAdminSession,
  saveProviderConfiguration,
  unlockAdminSession,
} from "./systemConfig";
import { getSystemHealth } from "./systemHealth";

const subtitleStyleInput = z.object({
  font: z.enum(["Noto Sans Thai", "Arial", "Inter"]).default("Noto Sans Thai"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
});
const subtitlePresetInput = z.enum(["thai_standard", "thai_story", "thai_minimal", "custom"]);
const customSubtitlePresetInput = subtitleStyleInput.extend({
  name: z.string().trim().min(1).max(80),
});
const providerConfigurationInput = z.object({
  ai: z.object({
    llmBaseUrl: z.string().url().optional(),
    llmApiKey: z.string().min(1).max(600).optional(),
    llmDefaultModel: z.string().trim().min(1).max(160).optional(),
    transcriptionBaseUrl: z.string().url().optional(),
    transcriptionApiKey: z.string().min(1).max(600).optional(),
    transcriptionModel: z.string().trim().min(1).max(160).optional(),
  }),
  storage: z.object({
    driver: z.enum(["local", "s3"]),
    localPath: z.string().trim().min(1).max(500).optional(),
    bucket: z.string().trim().min(3).max(255).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    endpoint: z.string().url().optional(),
    accessKeyId: z.string().trim().min(1).max(300).optional(),
    secretAccessKey: z.string().min(1).max(600).optional(),
    forcePathStyle: z.boolean().optional(),
  }),
});

function requireAdmin(ctx: { req: Parameters<typeof isAdminSession>[0] }) {
  if (!isAdminSession(ctx.req)) throw new Error("Admin access is required");
}
export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(GUEST_COOKIE_NAME, { httpOnly: true, sameSite: "lax", path: "/", maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  system: router({
    access: publicProcedure.query(({ ctx }) => ({ authorized: isAdminSession(ctx.req) })),
    unlock: publicProcedure.input(z.object({ token: z.string().min(1).max(512) })).mutation(({ ctx, input }) => {
      if (!unlockAdminSession(ctx.req, ctx.res, input.token)) throw new Error("Invalid administrator access token");
      return { success: true } as const;
    }),
    lock: publicProcedure.mutation(({ ctx }) => {
      lockAdminSession(ctx.req, ctx.res);
      return { success: true } as const;
    }),
    providerConfiguration: publicProcedure.query(async ({ ctx }) => {
      requireAdmin(ctx);
      return getPublicProviderConfiguration();
    }),
    saveProviderConfiguration: publicProcedure.input(providerConfigurationInput).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      await saveProviderConfiguration(input);
      return getPublicProviderConfiguration();
    }),
    health: publicProcedure.query(async ({ ctx }) => {
      requireAdmin(ctx);
      return getSystemHealth();
    }),
    runtimeSummary: publicProcedure.query(async ({ ctx }) => {
      requireAdmin(ctx);
      const config = await getRuntimeProviderConfig();
      return { storageDriver: config.storage.driver, llmConfigured: Boolean(config.ai.llmBaseUrl) };
    }),
  }),
  video: router({
    listJobs: publicProcedure.query(async ({ ctx }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      return db.listEditJobsForUser(actor.userId);
    }),
    listProjects: publicProcedure.input(z.object({ search: z.string().trim().max(120).optional() }).optional()).query(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      return db.listProjectsForUser(actor.userId, input?.search);
    }),
    listClips: publicProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      return db.listVideoClips(project.id, actor.userId);
    }),
    previewClipSilences: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      clipId: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      const clips = await db.listVideoClips(project.id, actor.userId);
      const clip = clips.find(item => item.id === input.clipId);
      if (!clip) throw new Error("Video clip was not found");
      return previewClipSilences(clip.storageKey, clip.trimStartMs, clip.trimEndMs);
    }),
    listCustomSubtitlePresets: publicProcedure.query(async ({ ctx }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      return db.listSubtitlePresetsForUser(actor.userId);
    }),
    listAiModels: publicProcedure.query(async () => listAiProducerModels()),
    draftAiEdit: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      prompt: z.string().trim().min(2).max(1200),
      model: z.string().trim().min(1).max(160).optional(),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      return createAiProducerDraft(input.prompt, input.model);
    }),
    listMcpAccessTokens: publicProcedure.input(z.object({ projectId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      return db.listMcpAccessTokensForUser(actor.userId, input?.projectId);
    }),
    listMcpAuditLogs: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).optional(),
    })).query(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const logs = await db.listMcpAuditLogsForUser(actor.userId, input.projectId, input.limit);
      if (!logs) throw new Error("Video project was not found");
      return logs;
    }),
    createMcpAccessToken: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      label: z.string().trim().min(1).max(80),
      scope: z.enum(["read", "edit", "render"]),
      expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const created = await db.createMcpAccessToken({
        userId: actor.userId,
        projectId: input.projectId,
        label: input.label,
        scope: input.scope,
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      });
      if (!created) throw new Error("Video project was not found");
      return created;
    }),
    revokeMcpAccessToken: publicProcedure.input(z.object({ tokenId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      const revoked = await db.revokeMcpAccessToken(input.tokenId, actor.userId);
      if (!revoked) throw new Error("MCP access token was not found");
      return { success: true } as const;
    }),
    createJob: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      command: z.string().trim().min(2).max(1200),
      subtitleStyle: subtitleStyleInput.optional(),
      subtitlePreset: subtitlePresetInput.optional(),
      customSubtitlePresetId: z.number().int().positive().optional(),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      const operationPlan = await interpretVideoCommand(input.command);
      let subtitlePreset = input.subtitlePreset ?? "thai_standard";
      let subtitleStyle = input.subtitleStyle ?? (subtitlePreset === "custom" ? subtitleStyleInput.parse({}) : subtitleStyleForPreset(subtitlePreset));
      if (input.customSubtitlePresetId) {
        const customPreset = await db.getSubtitlePresetForUser(input.customSubtitlePresetId, actor.userId);
        if (!customPreset) throw new Error("Custom subtitle preset was not found");
        subtitlePreset = "custom";
        subtitleStyle = { font: customPreset.font as "Noto Sans Thai" | "Arial" | "Inter", size: customPreset.size, position: customPreset.position };
      }
      return db.createEditJob({
        id: createJobId(),
        projectId: project.id,
        userId: actor.userId,
        command: input.command,
        commandLanguage: operationPlan.sourceLanguage,
        operationPlan,
        status: "queued",
        progress: 0,
        subtitleFont: subtitleStyle.font,
        subtitleSize: subtitleStyle.size,
        subtitlePosition: subtitleStyle.position,
        subtitlePreset,
      });
    }),
    renameProject: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      title: z.string().trim().min(1).max(255),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.renameVideoProject(input.projectId, actor.userId, input.title);
      if (!project) throw new Error("Video project was not found");
      return project;
    }),
    duplicateProject: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      title: z.string().trim().min(1).max(255).optional(),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const source = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!source) throw new Error("Video project was not found");
      const duplicated = await db.duplicateVideoProject(source.id, actor.userId, input.title ?? `Copy of ${source.title}`);
      if (!duplicated) throw new Error("Unable to duplicate the video project");
      return duplicated;
    }),
    createCustomSubtitlePreset: publicProcedure.input(customSubtitlePresetInput).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      return db.createSubtitlePreset({ userId: actor.userId, ...input });
    }),
    updateCustomSubtitlePreset: publicProcedure.input(customSubtitlePresetInput.extend({ presetId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      const { presetId, ...values } = input;
      const preset = await db.updateSubtitlePreset(presetId, actor.userId, values);
      if (!preset) throw new Error("Custom subtitle preset was not found");
      return preset;
    }),
    deleteCustomSubtitlePreset: publicProcedure.input(z.object({ presetId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      const deleted = await db.deleteSubtitlePreset(input.presetId, actor.userId);
      if (!deleted) throw new Error("Custom subtitle preset was not found");
      return { success: true } as const;
    }),
    setClipTrim: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      clipId: z.number().int().positive(),
      trimStartMs: z.number().int().min(0).max(180_000).nullable(),
      trimEndMs: z.number().int().min(0).max(180_000).nullable(),
    }).superRefine((value, issue) => {
      if (value.trimStartMs !== null && value.trimEndMs !== null && value.trimEndMs <= value.trimStartMs) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["trimEndMs"], message: "Clip end must be after its start" });
      }
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const clip = await db.updateVideoClipTrim(input.projectId, input.clipId, actor.userId, input.trimStartMs, input.trimEndMs);
      if (!clip) throw new Error("Video clip was not found");
      return clip;
    }),
    reorderClips: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      clipIds: z.array(z.number().int().positive()).min(1).max(12),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      return db.reorderVideoClips(input.projectId, actor.userId, input.clipIds);
    }),
    removeClip: publicProcedure.input(z.object({ projectId: z.number().int().positive(), clipId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const removed = await db.removeVideoClip(input.projectId, input.clipId, actor.userId);
      if (!removed) throw new Error("Video clip was not found");
      return { success: true } as const;
    }),
    deleteProject: publicProcedure.input(z.object({ projectId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.softDeleteProject(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      return { success: true } as const;
    }),
    deleteJob: publicProcedure.input(z.object({ jobId: z.string().regex(/^job_[a-zA-Z0-9_-]{8,64}$/) })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const job = await db.softDeleteEditJob(input.jobId, actor.userId);
      if (!job) throw new Error("Editing job was not found");
      return { success: true } as const;
    }),
    setProjectRetention: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      retention: z.enum(["seven_days", "thirty_days", "keep"]),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const expiresAt = input.retention === "keep" ? null : new Date(Date.now() + (input.retention === "seven_days" ? 7 : 30) * 24 * 60 * 60 * 1000);
      const project = await db.setProjectRetention(input.projectId, actor.userId, expiresAt);
      if (!project) throw new Error("Video project was not found");
      return project;
    }),
  }),
});

export type AppRouter = typeof appRouter;
