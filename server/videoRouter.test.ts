import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createEditJob: vi.fn(),
  getVideoProjectForUser: vi.fn(),
  interpretVideoCommand: vi.fn(),
  listProjectsForUser: vi.fn(),
  listVideoClips: vi.fn(),
  listEditJobsForUser: vi.fn(),
  renameVideoProject: vi.fn(),
  reorderVideoClips: vi.fn(),
  setProjectRetention: vi.fn(),
  softDeleteEditJob: vi.fn(),
  softDeleteProject: vi.fn(),
  sweepExpiredProjects: vi.fn(),
  updateVideoClipTrim: vi.fn(),
  resolveVideoActor: vi.fn(),
}));

vi.mock("./db", () => ({
  createEditJob: mocks.createEditJob,
  getVideoProjectForUser: mocks.getVideoProjectForUser,
  listEditJobsForUser: mocks.listEditJobsForUser,
  listProjectsForUser: mocks.listProjectsForUser,
  listVideoClips: mocks.listVideoClips,
  renameVideoProject: mocks.renameVideoProject,
  reorderVideoClips: mocks.reorderVideoClips,
  setProjectRetention: mocks.setProjectRetention,
  softDeleteEditJob: mocks.softDeleteEditJob,
  softDeleteProject: mocks.softDeleteProject,
  sweepExpiredProjects: mocks.sweepExpiredProjects,
  updateVideoClipTrim: mocks.updateVideoClipTrim,
}));

vi.mock("./videoEditing", () => ({
  createJobId: () => "job_test_001",
  interpretVideoCommand: mocks.interpretVideoCommand,
}));

vi.mock("./videoActor", () => ({ resolveVideoActor: mocks.resolveVideoActor }));

import { appRouter } from "./routers";

function createContext(userId: number | null = 7): TrpcContext {
  return {
    user: userId === null ? null : {
      id: userId,
      openId: `user-${userId}`,
      name: "Video Tester",
      email: null,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("video router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveVideoActor.mockResolvedValue({ userId: 7, isGuest: false });
    mocks.interpretVideoCommand.mockResolvedValue({ sourceLanguage: "th", operations: [{ type: "generate_subtitles" }], summary: "สร้างซับไตเติล" });
    mocks.sweepExpiredProjects.mockResolvedValue(0);
  });

  it("creates a queued job only for a project owned by the caller", async () => {
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 33, userId: 7 });
    mocks.createEditJob.mockResolvedValue({ id: "job_test_001", status: "queued", progress: 0 });
    const caller = appRouter.createCaller(createContext());

    const result = await caller.video.createJob({ projectId: 33, command: "สร้างซับไตเติล" });

    expect(mocks.getVideoProjectForUser).toHaveBeenCalledWith(33, 7);
    expect(mocks.createEditJob).toHaveBeenCalledWith(expect.objectContaining({
      id: "job_test_001",
      projectId: 33,
      userId: 7,
      status: "queued",
      progress: 0,
      commandLanguage: "th",
    }));
    expect(result).toMatchObject({ id: "job_test_001", status: "queued" });
  });

  it("records the user-selected subtitle style with an edit job", async () => {
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 33, userId: 7 });
    mocks.createEditJob.mockResolvedValue({ id: "job_test_001", status: "queued", progress: 0 });
    const caller = appRouter.createCaller(createContext());

    await caller.video.createJob({ projectId: 33, command: "สร้างซับไตเติล", subtitleStyle: { font: "Inter", size: "large", position: "top" } });

    expect(mocks.createEditJob).toHaveBeenCalledWith(expect.objectContaining({
      subtitleFont: "Inter",
      subtitleSize: "large",
      subtitlePosition: "top",
    }));
  });

  it("uses the selected Thai subtitle preset when a manual style is not supplied", async () => {
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 33, userId: 7 });
    mocks.createEditJob.mockResolvedValue({ id: "job_test_001", status: "queued", progress: 0 });
    const caller = appRouter.createCaller(createContext());

    await caller.video.createJob({ projectId: 33, command: "สร้างซับไตเติล", subtitlePreset: "thai_story" });

    expect(mocks.createEditJob).toHaveBeenCalledWith(expect.objectContaining({
      subtitlePreset: "thai_story",
      subtitleFont: "Noto Sans Thai",
      subtitleSize: "large",
      subtitlePosition: "middle",
    }));
  });

  it("does not create a job when the project is not owned by the caller", async () => {
    mocks.getVideoProjectForUser.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.video.createJob({ projectId: 99, command: "สร้างซับไตเติล" })).rejects.toThrow("Video project was not found");
    expect(mocks.createEditJob).not.toHaveBeenCalled();
  });

  it("lists jobs for a browser guest without a signed-in user", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.listEditJobsForUser.mockResolvedValue([{ id: "job_guest_001", userId: 101 }]);
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.listJobs()).resolves.toEqual([{ id: "job_guest_001", userId: 101 }]);
    expect(mocks.listEditJobsForUser).toHaveBeenCalledWith(101);
  });

  it("reorders clips only through the current guest's project ownership", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.reorderVideoClips.mockResolvedValue([{ id: 9, sortOrder: 0 }, { id: 8, sortOrder: 1 }]);
    const caller = appRouter.createCaller(createContext(null));

    await caller.video.reorderClips({ projectId: 55, clipIds: [9, 8] });

    expect(mocks.reorderVideoClips).toHaveBeenCalledWith(55, 101, [9, 8]);
  });

  it("persists a selected clip range only within the current guest project", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.updateVideoClipTrim.mockResolvedValue({ id: 9, projectId: 55, trimStartMs: 500, trimEndMs: 2500 });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.setClipTrim({ projectId: 55, clipId: 9, trimStartMs: 500, trimEndMs: 2500 })).resolves.toMatchObject({ id: 9, trimStartMs: 500, trimEndMs: 2500 });
    expect(mocks.updateVideoClipTrim).toHaveBeenCalledWith(55, 9, 101, 500, 2500);
  });

  it("searches and renames only projects owned by the current guest", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.listProjectsForUser.mockResolvedValue([{ id: 55, title: "Thai story" }]);
    mocks.renameVideoProject.mockResolvedValue({ id: 55, title: "Final Thai story" });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.listProjects({ search: "Thai" })).resolves.toEqual([{ id: 55, title: "Thai story" }]);
    await expect(caller.video.renameProject({ projectId: 55, title: "Final Thai story" })).resolves.toMatchObject({ title: "Final Thai story" });
    expect(mocks.listProjectsForUser).toHaveBeenCalledWith(101, "Thai");
    expect(mocks.renameVideoProject).toHaveBeenCalledWith(55, 101, "Final Thai story");
  });

  it("soft-deletes a job only when it belongs to the current guest", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.softDeleteEditJob.mockResolvedValue({ id: "job_guest_delete_1", userId: 101 });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.deleteJob({ jobId: "job_guest_delete_1" })).resolves.toEqual({ success: true });
    expect(mocks.softDeleteEditJob).toHaveBeenCalledWith("job_guest_delete_1", 101);
  });

  it("sets a seven-day retention deadline for the project owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    mocks.setProjectRetention.mockResolvedValue({ id: 33 });
    const caller = appRouter.createCaller(createContext());

    await caller.video.setProjectRetention({ projectId: 33, retention: "seven_days" });

    expect(mocks.setProjectRetention).toHaveBeenCalledWith(33, 7, new Date("2026-08-20T00:00:00.000Z"));
    vi.useRealTimers();
  });
});
