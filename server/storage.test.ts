import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("storagePut", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes a video buffer through the local self-hosted storage adapter", async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cineflow-storage-unit-"));
    process.env.CINEFLOW_STORAGE_DRIVER = "local";
    process.env.CINEFLOW_LOCAL_STORAGE_PATH = tempDir;
    const { storagePut, storageGetSignedUrl } = await import("./storage");
    const source = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const output = await storagePut("users/1/video-editor/sources/clip.mp4", source, "video/mp4");

    expect(output.key).toMatch(/^users\/1\/video-editor\/sources\/clip_[a-f0-9]{8}\.mp4$/);
    expect(output.url).toBe(`/api/media?key=${encodeURIComponent(output.key)}`);
    expect(await storageGetSignedUrl(output.key)).toMatch(/^file:/);
  });

  it("supports FormData with a video Blob for file upload requests", async () => {
    const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const form = new FormData();
    form.append("video", new Blob([bytes], { type: "video/mp4" }), "clip.mp4");

    const request = new Request("https://cineflow.example/upload", {
      method: "POST",
      body: form,
    });
    const payload = Buffer.from(await request.arrayBuffer());

    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(payload.includes(bytes)).toBe(true);
    expect(payload.toString("utf8")).toContain('filename="clip.mp4"');
  });
});
