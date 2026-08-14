import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  purgeExpiredUploadSessions: vi.fn(),
  storageDelete: vi.fn(),
}));

vi.mock("./db", () => ({ purgeExpiredUploadSessions: mocks.purgeExpiredUploadSessions }));
vi.mock("./storage", () => ({ storageDelete: mocks.storageDelete }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticateRequest } }));

import { registerUploadCleanupRoutes } from "./uploadCleanupRoutes";

function routeRegistry() {
  const routes: Array<{ path: string; handler: (req: any, res: any) => Promise<unknown> }> = [];
  registerUploadCleanupRoutes({ post: (path: string, handler: (req: any, res: any) => Promise<unknown>) => routes.push({ path, handler }) } as any);
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

describe("scheduled upload session cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.storageDelete.mockResolvedValue(undefined);
  });

  it("purges expired staging objects for an authenticated cron callback", async () => {
    mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "task_nightly" });
    mocks.purgeExpiredUploadSessions.mockResolvedValue(["users/7/video-editor/staging/expired/0.part"]);
    const route = routeRegistry()[0];
    const { response, state } = responseProbe();

    await route.handler({ originalUrl: "/api/scheduled/purge-expired-upload-sessions", headers: {} }, response);

    expect(mocks.storageDelete).toHaveBeenCalledWith("users/7/video-editor/staging/expired/0.part");
    expect(state.body).toEqual({ ok: true, taskUid: "task_nightly", purgedParts: 1 });
  });

  it("rejects a non-cron request without touching storage", async () => {
    mocks.authenticateRequest.mockResolvedValue({ isCron: false, taskUid: null });
    const route = routeRegistry()[0];
    const { response, state } = responseProbe();

    await route.handler({ originalUrl: "/api/scheduled/purge-expired-upload-sessions", headers: {} }, response);

    expect(state.statusCode).toBe(403);
    expect(mocks.purgeExpiredUploadSessions).not.toHaveBeenCalled();
  });
});
