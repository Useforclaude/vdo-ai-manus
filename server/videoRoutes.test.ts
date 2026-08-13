import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEditJobForUser: vi.fn(),
  processVideoJob: vi.fn(),
  resolveVideoActor: vi.fn(),
  storageGetSignedUrl: vi.fn(),
  sweepExpiredProjects: vi.fn(),
}));

vi.mock("./db", () => ({ getEditJobForUser: mocks.getEditJobForUser, sweepExpiredProjects: mocks.sweepExpiredProjects }));
vi.mock("./videoEditing", () => ({ MAX_SOURCE_BYTES: 180 * 1024 * 1024, processVideoJob: mocks.processVideoJob }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageGetSignedUrl: mocks.storageGetSignedUrl }));
vi.mock("./videoActor", () => ({ resolveVideoActor: mocks.resolveVideoActor }));

import { getDownloadAsset, registerVideoRoutes } from "./videoRoutes";

type RegisteredRoute = { path: string; handlers: Array<(req: any, res: any) => Promise<unknown> | unknown> };

function routeRegistry() {
  const routes: RegisteredRoute[] = [];
  const app = {
    post: (path: string, ...handlers: RegisteredRoute["handlers"]) => routes.push({ path, handlers }),
    get: (path: string, ...handlers: RegisteredRoute["handlers"]) => routes.push({ path, handlers }),
  };
  registerVideoRoutes(app as any);
  return routes;
}

function responseProbe() {
  const state = { statusCode: 200, body: undefined as unknown };
  const response = {
    status: vi.fn((code: number) => { state.statusCode = code; return response; }),
    json: vi.fn((body: unknown) => { state.body = body; return response; }),
  };
  return { response, state };
}

describe("video process endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveVideoActor.mockResolvedValue({ userId: 7, isGuest: false });
    mocks.processVideoJob.mockResolvedValue(undefined);
    mocks.sweepExpiredProjects.mockResolvedValue(0);
  });

  it("rejects a malformed job identifier before querying the database", async () => {
    const route = routeRegistry().find(entry => entry.path === "/api/video-jobs/:jobId/process");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { jobId: "not-valid" } }, response);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: "Invalid editing job" });
    expect(mocks.getEditJobForUser).not.toHaveBeenCalled();
  });

  it("returns a terminal job without scheduling a second processor", async () => {
    const job = { id: "job_terminal_001", status: "complete", progress: 100 };
    mocks.getEditJobForUser.mockResolvedValue(job);
    const route = routeRegistry().find(entry => entry.path === "/api/video-jobs/:jobId/process");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { jobId: job.id } }, response);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ job });
    expect(mocks.processVideoJob).not.toHaveBeenCalled();
  });

  it("acknowledges a queued job and starts processing for the current actor", async () => {
    const job = { id: "job_pending_002", status: "queued", progress: 0 };
    mocks.getEditJobForUser.mockResolvedValue(job);
    const route = routeRegistry().find(entry => entry.path === "/api/video-jobs/:jobId/process");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { jobId: job.id } }, response);

    expect(mocks.getEditJobForUser).toHaveBeenCalledWith(job.id, 7);
    expect(mocks.processVideoJob).toHaveBeenCalledWith(job.id, 7);
    expect(state.statusCode).toBe(202);
    expect(state.body).toEqual({ job });
  });

  it("uses a guest actor to keep queued work scoped to its browser session", async () => {
    const job = { id: "job_guest_003", status: "queued", progress: 0 };
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.getEditJobForUser.mockResolvedValue(job);
    const route = routeRegistry().find(entry => entry.path === "/api/video-jobs/:jobId/process");
    const { response } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { jobId: job.id } }, response);

    expect(mocks.getEditJobForUser).toHaveBeenCalledWith(job.id, 101);
    expect(mocks.processVideoJob).toHaveBeenCalledWith(job.id, 101);
  });
});

describe("video download endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveVideoActor.mockResolvedValue({ userId: 101, isGuest: true });
    mocks.sweepExpiredProjects.mockResolvedValue(0);
  });

  it("selects stable storage keys and attachment names for completed outputs", () => {
    const job = { id: "job_output_004", processedStorageKey: "users/101/video-editor/job_output_004/edited.mp4", subtitleStorageKey: "users/101/video-editor/job_output_004/subtitles.srt" };

    expect(getDownloadAsset(job, "video")).toEqual({ storageKey: job.processedStorageKey, fileName: "cineflow-edit-job_output_004.mp4", contentType: "video/mp4" });
    expect(getDownloadAsset(job, "subtitle")).toEqual({ storageKey: job.subtitleStorageKey, fileName: "cineflow-subtitles-job_output_004.srt", contentType: "application/x-subrip" });
  });

  it("does not attempt storage access when a guest does not own the requested job", async () => {
    mocks.getEditJobForUser.mockResolvedValue(undefined);
    const route = routeRegistry().find(entry => entry.path === "/api/video-jobs/:jobId/download");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { jobId: "job_private_005" }, query: { asset: "video" } }, response);

    expect(mocks.getEditJobForUser).toHaveBeenCalledWith("job_private_005", 101);
    expect(mocks.storageGetSignedUrl).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(404);
    expect(state.body).toEqual({ error: "Editing job was not found" });
  });
});
