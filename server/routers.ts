import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createJobId, interpretVideoCommand } from "./videoEditing";

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
    listJobs: protectedProcedure.query(({ ctx }) => db.listEditJobsForUser(ctx.user.id)),
    createJob: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), command: z.string().trim().min(2).max(1200) })).mutation(async ({ ctx, input }) => {
      const project = await db.getVideoProjectForUser(input.projectId, ctx.user.id);
      if (!project) throw new Error("Video project was not found");
      const operationPlan = await interpretVideoCommand(input.command);
      return db.createEditJob({
        id: createJobId(),
        projectId: project.id,
        userId: ctx.user.id,
        command: input.command,
        commandLanguage: operationPlan.sourceLanguage,
        operationPlan,
        status: "queued",
        progress: 0,
      });
    }),
  }),
});

export type AppRouter = typeof appRouter;
