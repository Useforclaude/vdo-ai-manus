import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const originalEnv = { ...process.env };
let tempDir = "";

beforeEach(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cineflow-storage-test-"));
  process.env.CINEFLOW_STORAGE_DRIVER = "local";
  process.env.CINEFLOW_LOCAL_STORAGE_PATH = tempDir;
  delete process.env.CINEFLOW_LLM_BASE_URL;
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("portable runtime adapters", () => {
  it("stores objects locally and returns a self-hosted media route", async () => {
    const { storagePut, storageGetSignedUrl } = await import("./storage");
    const stored = await storagePut("users/1/source.mp4", Buffer.from("video"), "video/mp4");

    expect(stored.key).toMatch(/^users\/1\/source_[a-f0-9]{8}\.mp4$/);
    expect(stored.url).toBe(`/api/media?key=${encodeURIComponent(stored.key)}`);
    const localUrl = await storageGetSignedUrl(stored.key);
    expect(localUrl).toMatch(/^file:/);
  });

  it("builds a stable endpoint for OpenAI-compatible providers", async () => {
    const { getOpenAiCompatibleUrl } = await import("./runtimeConfig");
    expect(getOpenAiCompatibleUrl("http://localhost:11434/v1", "/chat/completions"))
      .toBe("http://localhost:11434/v1/chat/completions");
  });
});
