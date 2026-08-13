import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createEditJob: vi.fn(),
  createAiProducerDraft: vi.fn(),
  createMcpAccessToken: vi.fn(),
  createSubtitlePreset: vi.fn(),
  deleteSubtitlePreset: vi.fn(),
  duplicateVideoProject: vi.fn(),
  getVideoProjectForUser: vi.fn(),
  getSubtitlePresetForUser: vi.fn(),
  interpretVideoCommand: vi.fn(),
  listProjectsForUser: vi.fn(),
  listSubtitlePresetsForUser: vi.fn(),
  listVideoClips: vi.fn(),
  previewClipSilences: vi.fn(),
  listEditJobsForUser: vi.fn(),
  listAiProducerModels: vi.fn(),
  listMcpAccessTokensForUser: vi.fn(),
  renameVideoProject: vi.fn(),
  reorderVideoClips: vi.fn(),
  revokeMcpAccessToken: vi.fn(),
  setProjectRetention: vi.fn(),
  softDeleteEditJob: vi.fn(),
  softDeleteProject: vi.fn(),
  sweepExpiredProjects: vi.fn(),
  updateSubtitlePreset: vi.fn(),
  updateVideoClipTrim: vi.fn(),
  resolveVideoActor: vi.fn(),
}));

vi.mock("./db", () => ({
  createEditJob: mocks.createEditJob,
  createMcpAccessToken: mocks.createMcpAccessToken,
  createSubtitlePreset: mocks.createSubtitlePreset,
  deleteSubtitlePreset: mocks.deleteSubtitlePreset,
  duplicateVideoProject: mocks.duplicateVideoProject,
  getVideoProjectForUser: mocks.getVideoProjectForUser,
  getSubtitlePresetForUser: mocks.getSubtitlePresetForUser,
  listEditJobsForUser: mocks.listEditJobsForUser,
  listMcpAccessTokensForUser: mocks.listMcpAccessTokensForUser,
  listProjectsForUser: mocks.listProjectsForUser,
  listSubtitlePresetsForUser: mocks.listSubtitlePresetsForUser,
  listVideoClips: mocks.listVideoClips,
  renameVideoProject: mocks.renameVideoProject,
  reorderVideoClips: mocks.reorderVideoClips,
  revokeMcpAccessToken: mocks.revokeMcpAccessToken,
  setProjectRetention: mocks.setProjectRetention,
  softDeleteEditJob: mocks.softDeleteEditJob,
  softDeleteProject: mocks.softDeleteProject,
  sweepExpiredProjects: mocks.sweepExpiredProjects,
  updateSubtitlePreset: mocks.updateSubtitlePreset,
  updateVideoClipTrim: mocks.updateVideoClipTrim,
}));

vi.mock("./videoEditing", () => ({
  createJobId: () => "job_test_001",
  interpretVideoCommand: mocks.interpretVideoCommand,
  previewClipSilences: mocks.previewClipSilences,
}));

vi.mock("./aiProducer", () => ({
  createAiProducerDraft: mocks.createAiProducerDraft,
  listAiProducerModels: mocks.listAiProducerModels,
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

  it("previews silence only for a clip owned by the current guest project", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 55, userId: 101 });
    mocks.listVideoClips.mockResolvedValue([{ id: 9, projectId: 55, storageKey: "users/101/clip.mp4", trimStartMs: 500, trimEndMs: 2500 }]);
    mocks.previewClipSilences.mockResolvedValue({ hasAudio: true, sourceDurationMs: 3000, timelineDurationMs: 2000, removedDurationMs: 800, silenceRanges: [{ startMs: 500, endMs: 1300, durationMs: 800 }] });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.previewClipSilences({ projectId: 55, clipId: 9 })).resolves.toMatchObject({ removedDurationMs: 800, silenceRanges: [{ durationMs: 800 }] });
    expect(mocks.getVideoProjectForUser).toHaveBeenCalledWith(55, 101);
    expect(mocks.listVideoClips).toHaveBeenCalledWith(55, 101);
    expect(mocks.previewClipSilences).toHaveBeenCalledWith("users/101/clip.mp4", 500, 2500);
  });

  it("does not preview silence for a clip missing from the current guest project", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 55, userId: 101 });
    mocks.listVideoClips.mockResolvedValue([]);
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.previewClipSilences({ projectId: 55, clipId: 9 })).rejects.toThrow("Video clip was not found");
    expect(mocks.previewClipSilences).not.toHaveBeenCalled();
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

  it("duplicates only the current guest's project and preserves a clear copy title", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 55, userId: 101, title: "Interview cut" });
    mocks.duplicateVideoProject.mockResolvedValue({ id: 56, userId: 101, title: "Copy of Interview cut" });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.duplicateProject({ projectId: 55 })).resolves.toMatchObject({ id: 56, title: "Copy of Interview cut" });

    expect(mocks.getVideoProjectForUser).toHaveBeenCalledWith(55, 101);
    expect(mocks.duplicateVideoProject).toHaveBeenCalledWith(55, 101, "Copy of Interview cut");
  });

  it("does not duplicate a project outside the current guest session", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getVideoProjectForUser.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.duplicateProject({ projectId: 55 })).rejects.toThrow("Video project was not found");
    expect(mocks.duplicateVideoProject).not.toHaveBeenCalled();
  });

  it("lists and creates custom subtitle presets only for the current guest", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.listSubtitlePresetsForUser.mockResolvedValue([{ id: 9, userId: 101, name: "Green Thai", font: "Noto Sans Thai", size: "medium", position: "bottom" }]);
    mocks.createSubtitlePreset.mockResolvedValue({ id: 10, userId: 101, name: "Top Inter", font: "Inter", size: "large", position: "top" });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.listCustomSubtitlePresets()).resolves.toHaveLength(1);
    await expect(caller.video.createCustomSubtitlePreset({ name: "Top Inter", font: "Inter", size: "large", position: "top" })).resolves.toMatchObject({ id: 10, userId: 101 });

    expect(mocks.listSubtitlePresetsForUser).toHaveBeenCalledWith(101);
    expect(mocks.createSubtitlePreset).toHaveBeenCalledWith({ userId: 101, name: "Top Inter", font: "Inter", size: "large", position: "top" });
  });

  it("surfaces the 20-preset limit without accepting an extra saved style", async () => {
    mocks.createSubtitlePreset.mockRejectedValue(new Error("You can save up to 20 custom subtitle presets"));
    const caller = appRouter.createCaller(createContext());

    await expect(caller.video.createCustomSubtitlePreset({ name: "One too many", font: "Arial", size: "small", position: "bottom" })).rejects.toThrow("up to 20 custom subtitle presets");
    expect(mocks.createSubtitlePreset).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, name: "One too many" }));
  });

  it("updates a custom subtitle preset only through its current guest owner", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.updateSubtitlePreset.mockResolvedValue({ id: 9, userId: 101, name: "Clear Thai", font: "Noto Sans Thai", size: "large", position: "top" });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.updateCustomSubtitlePreset({ presetId: 9, name: "Clear Thai", font: "Noto Sans Thai", size: "large", position: "top" })).resolves.toMatchObject({ id: 9, userId: 101 });
    expect(mocks.updateSubtitlePreset).toHaveBeenCalledWith(9, 101, { name: "Clear Thai", font: "Noto Sans Thai", size: "large", position: "top" });
  });

  it("deletes a custom subtitle preset only through its guest owner", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.deleteSubtitlePreset.mockResolvedValue(true);
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.deleteCustomSubtitlePreset({ presetId: 9 })).resolves.toEqual({ success: true });
    expect(mocks.deleteSubtitlePreset).toHaveBeenCalledWith(9, 101);

    mocks.deleteSubtitlePreset.mockResolvedValue(false);
    await expect(caller.video.deleteCustomSubtitlePreset({ presetId: 99 })).rejects.toThrow("Custom subtitle preset was not found");
  });

  it("drafts an AI command only for the current guest project without creating a render job", async () => {
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 55, userId: 101, title: "Interview cut" });
    mocks.createAiProducerDraft.mockResolvedValue({ command: "ตัดช่วงเงียบ", selectedModel: "gemini-2.5-flash", summary: "ตัดช่วงเงียบ", operations: [], sourceLanguage: "th" });
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.draftAiEdit({ projectId: 55, prompt: "ตัดช่วงเงียบ", model: "gemini-2.5-flash" })).resolves.toMatchObject({ selectedModel: "gemini-2.5-flash" });

    expect(mocks.createAiProducerDraft).toHaveBeenCalledWith("ตัดช่วงเงียบ", "gemini-2.5-flash");
    expect(mocks.createEditJob).not.toHaveBeenCalled();
  });

  it("creates and revokes MCP capability tokens only under the current guest owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.createMcpAccessToken.mockResolvedValue({ token: "cfmcp_secret", access: { id: 8, projectId: 55, userId: 101, scope: "edit" } });
    mocks.revokeMcpAccessToken.mockResolvedValue(true);
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.video.createMcpAccessToken({ projectId: 55, label: "Claude Desktop", scope: "edit", expiresInDays: 7 })).resolves.toMatchObject({ token: "cfmcp_secret" });
    await expect(caller.video.revokeMcpAccessToken({ tokenId: 8 })).resolves.toEqual({ success: true });

    expect(mocks.createMcpAccessToken).toHaveBeenCalledWith(expect.objectContaining({ userId: 101, projectId: 55, scope: "edit", expiresAt: new Date("2026-08-20T00:00:00.000Z") }));
    expect(mocks.revokeMcpAccessToken).toHaveBeenCalledWith(8, 101);
    vi.useRealTimers();
  });
});
