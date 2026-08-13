import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createEditJob: vi.fn(),
  getVideoProjectForUser: vi.fn(),
  interpretVideoCommand: vi.fn(),
  listEditJobsForUser: vi.fn(),
  resolveVideoActor: vi.fn(),
}));

vi.mock("./db", () => ({
  createEditJob: mocks.createEditJob,
  getVideoProjectForUser: mocks.getVideoProjectForUser,
  listEditJobsForUser: mocks.listEditJobsForUser,
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
});
