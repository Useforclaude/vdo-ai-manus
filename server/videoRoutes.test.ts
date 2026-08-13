import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEditJobForUser: vi.fn(),
  processVideoJob: vi.fn(),
  resolveVideoActor: vi.fn(),
}));

vi.mock("./db", () => ({ getEditJobForUser: mocks.getEditJobForUser }));
vi.mock("./videoEditing", () => ({ MAX_SOURCE_BYTES: 180 * 1024 * 1024, processVideoJob: mocks.processVideoJob }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./videoActor", () => ({ resolveVideoActor: mocks.resolveVideoActor }));

import { registerVideoRoutes } from "./videoRoutes";

type RegisteredRoute = { path: string; handlers: Array<(req: any, res: any) => Promise<unknown> | unknown> };

function routeRegistry() {
  const routes: RegisteredRoute[] = [];
  const app = {
    post: (path: string, ...handlers: RegisteredRoute["handlers"]) => routes.push({ path, handlers }),
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
