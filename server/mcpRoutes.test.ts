import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveMcpAccessToken: vi.fn(),
  getVideoProjectForUser: vi.fn(),
  listVideoClips: vi.fn(),
  updateVideoClipTrim: vi.fn(),
  reorderVideoClips: vi.fn(),
  listEditJobsForUser: vi.fn(),
  createEditJob: vi.fn(),
  previewClipSilences: vi.fn(),
  interpretVideoCommand: vi.fn(),
  processVideoJob: vi.fn(),
  createMcpAuditLog: vi.fn(),
}));

vi.mock("./db", () => ({
  resolveMcpAccessToken: mocks.resolveMcpAccessToken,
  getVideoProjectForUser: mocks.getVideoProjectForUser,
  listVideoClips: mocks.listVideoClips,
  updateVideoClipTrim: mocks.updateVideoClipTrim,
  reorderVideoClips: mocks.reorderVideoClips,
  listEditJobsForUser: mocks.listEditJobsForUser,
  createEditJob: mocks.createEditJob,
  createMcpAuditLog: mocks.createMcpAuditLog,
}));

vi.mock("./videoEditing", () => ({
  createJobId: () => "job_mcp_test_001",
  previewClipSilences: mocks.previewClipSilences,
  interpretVideoCommand: mocks.interpretVideoCommand,
  processVideoJob: mocks.processVideoJob,
}));

import { registerMcpRoutes } from "./mcpRoutes";

let server: Server | undefined;
let endpoint = "";

async function callMcp(method: string, params?: Record<string, unknown>, token = "cfmcp_abcdefghijklmnopqrstuvwxyz123456") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

describe("Cineflow MCP routes", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const app = express();
    app.use(express.json());
    registerMcpRoutes(app);
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/mcp`;
    mocks.getVideoProjectForUser.mockResolvedValue({ id: 31, userId: 7, title: "Launch cut", durationSeconds: 12, expiresAt: null });
    mocks.listVideoClips.mockResolvedValue([{ id: 5, projectId: 31, userId: 7, originalName: "intro.mp4", sortOrder: 0, trimStartMs: 0, trimEndMs: null, storageKey: "private-key", storageUrl: "private-url" }]);
  });

  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  });

  it("rejects requests that do not present a valid project capability token", async () => {
    const { response, body } = await callMcp("initialize");

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: { code: -32001 } });
  });

  it("lists the authorized project timeline without exposing source URLs or storage keys", async () => {
    mocks.resolveMcpAccessToken.mockResolvedValue({ id: 4, userId: 7, projectId: 31, scope: "read" });

    const { response, body } = await callMcp("tools/call", { name: "cineflow_timeline", arguments: {} });
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(text).toContain("intro.mp4");
    expect(text).not.toContain("private-key");
    expect(text).not.toContain("private-url");
    expect(mocks.getVideoProjectForUser).toHaveBeenCalledWith(31, 7);
  });

  it("prevents a read token from changing timeline trim points", async () => {
    mocks.resolveMcpAccessToken.mockResolvedValue({ id: 4, userId: 7, projectId: 31, scope: "read" });

    const { body } = await callMcp("tools/call", {
      name: "cineflow_apply_trim",
      arguments: { clipId: 5, trimStartMs: 1000, trimEndMs: 4000 },
    });

    expect(JSON.stringify(body)).toContain("requires an edit or render token");
    expect(mocks.updateVideoClipTrim).not.toHaveBeenCalled();
  });

  it("publishes guided prompts that tell agents to confirm before changing or rendering", async () => {
    mocks.resolveMcpAccessToken.mockResolvedValue({ id: 4, userId: 7, projectId: 31, scope: "read" });

    const { body } = await callMcp("prompts/get", { name: "cineflow_remove_silence" });
    const text = JSON.stringify(body);

    expect(text).toContain("ask for confirmation");
    expect(text).toContain("Never expose source URLs");
  });

  it("records a sanitized audit entry for each MCP tool call", async () => {
    mocks.resolveMcpAccessToken.mockResolvedValue({ id: 4, userId: 7, projectId: 31, scope: "read" });

    await callMcp("tools/call", { name: "cineflow_timeline", arguments: {} });

    expect(mocks.createMcpAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      projectId: 31,
      tokenId: 4,
      toolName: "cineflow_timeline",
      status: "succeeded",
      requestSummary: "{}",
    }));
    const auditEntry = mocks.createMcpAuditLog.mock.calls[0]?.[0] as { resultSummary: string };
    expect(auditEntry.resultSummary).not.toContain("private-key");
    expect(auditEntry.resultSummary).not.toContain("private-url");
  });
});
