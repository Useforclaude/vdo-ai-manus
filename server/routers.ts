import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createJobId, interpretVideoCommand } from "./videoEditing";
import { resolveVideoActor } from "./videoActor";
import { subtitleStyleForPreset } from "@shared/subtitles";

const subtitleStyleInput = z.object({
  font: z.enum(["Noto Sans Thai", "Arial", "Inter"]).default("Noto Sans Thai"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
});
const subtitlePresetInput = z.enum(["thai_standard", "thai_story", "thai_minimal", "custom"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
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
    createJob: publicProcedure.input(z.object({
      projectId: z.number().int().positive(),
      command: z.string().trim().min(2).max(1200),
      subtitleStyle: subtitleStyleInput.optional(),
      subtitlePreset: subtitlePresetInput.optional(),
    })).mutation(async ({ ctx, input }) => {
      const actor = await resolveVideoActor(ctx.req, ctx.res, ctx.user);
      await db.sweepExpiredProjects(actor.userId);
      const project = await db.getVideoProjectForUser(input.projectId, actor.userId);
      if (!project) throw new Error("Video project was not found");
      const operationPlan = await interpretVideoCommand(input.command);
      const subtitlePreset = input.subtitlePreset ?? "thai_standard";
      const subtitleStyle = input.subtitleStyle ?? (subtitlePreset === "custom" ? subtitleStyleInput.parse({}) : subtitleStyleForPreset(subtitlePreset));
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
