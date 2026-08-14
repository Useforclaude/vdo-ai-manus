import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelVideoUploadSession: vi.fn(),
  createVideoUploadSession: vi.fn(),
  purgeExpiredUploadSessions: vi.fn(),
  resolveVideoActor: vi.fn(),
  storageDelete: vi.fn(),
  sweepExpiredProjects: vi.fn(),
}));

vi.mock("./db", () => ({
  createVideoUploadSession: mocks.createVideoUploadSession,
  sweepExpiredProjects: mocks.sweepExpiredProjects,
  purgeExpiredUploadSessions: mocks.purgeExpiredUploadSessions,
  cancelVideoUploadSession: mocks.cancelVideoUploadSession,
}));
vi.mock("./storage", () => ({
  storageDelete: mocks.storageDelete,
  storagePut: vi.fn(),
  storagePutExact: vi.fn(),
  storageRead: vi.fn(),
}));
vi.mock("./videoEditing", () => ({ MAX_SOURCE_BYTES: 180 * 1024 * 1024 }));
vi.mock("./videoActor", () => ({ resolveVideoActor: mocks.resolveVideoActor }));

import { registerVideoChunkRoutes } from "./videoChunkRoutes";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
type RegisteredRoute = { path: string; handlers: Handler[] };

function routeRegistry() {
  const routes: RegisteredRoute[] = [];
  const app = {
    post: (path: string, ...handlers: Handler[]) => routes.push({ path, handlers }),
    put: (path: string, ...handlers: Handler[]) => routes.push({ path, handlers }),
    delete: (path: string, ...handlers: Handler[]) => routes.push({ path, handlers }),
  };
  registerVideoChunkRoutes(app as any);
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

describe("chunked video upload cancellation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveVideoActor.mockResolvedValue({ userId: 7, isGuest: true });
    mocks.purgeExpiredUploadSessions.mockResolvedValue([]);
    mocks.sweepExpiredProjects.mockResolvedValue(0);
    mocks.storageDelete.mockResolvedValue(undefined);
  });

  it("cleans expired staging parts when a new upload session starts", async () => {
    mocks.purgeExpiredUploadSessions.mockResolvedValue(["users/7/video-editor/staging/expired/0.part"]);
    mocks.createVideoUploadSession.mockResolvedValue({ id: "upload_1234567890abcdef1234567890abcdef" });
    const route = routeRegistry().find(entry => entry.path === "/api/video-uploads");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ body: { fileName: "clip.mp4", mimeType: "video/mp4", totalBytes: 20, totalParts: 1 } }, response);

    expect(mocks.purgeExpiredUploadSessions).toHaveBeenCalledOnce();
    expect(mocks.storageDelete).toHaveBeenCalledWith("users/7/video-editor/staging/expired/0.part");
    expect(state.statusCode).toBe(201);
    expect(state.body).toMatchObject({ uploadId: "upload_1234567890abcdef1234567890abcdef", partBytes: 4 * 1024 * 1024 });
  });

  it("removes only the current actor's staging parts when an upload is cancelled", async () => {
    mocks.cancelVideoUploadSession.mockResolvedValue([{ storageKey: "users/7/video-editor/staging/upload_1234567890abcdef1234567890abcdef/0.part" }]);
    const route = routeRegistry().find(entry => entry.path === "/api/video-uploads/:sessionId");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { sessionId: "upload_1234567890abcdef1234567890abcdef" } }, response);

    expect(mocks.cancelVideoUploadSession).toHaveBeenCalledWith("upload_1234567890abcdef1234567890abcdef", 7);
    expect(mocks.storageDelete).toHaveBeenCalledWith("users/7/video-editor/staging/upload_1234567890abcdef1234567890abcdef/0.part");
    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ cancelled: true, removedParts: 1 });
  });

  it("rejects malformed upload identifiers before looking up an actor session", async () => {
    const route = routeRegistry().find(entry => entry.path === "/api/video-uploads/:sessionId");
    const { response, state } = responseProbe();

    await route?.handlers.at(-1)?.({ params: { sessionId: "bad-id" } }, response);

    expect(state.statusCode).toBe(400);
    expect(mocks.cancelVideoUploadSession).not.toHaveBeenCalled();
  });
});
