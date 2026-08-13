import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example",
    forgeApiKey: "test-forge-key",
  },
}));

import { storagePut } from "./storage";

describe("storagePut", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("creates a Blob from a video buffer and uploads it after presigning", async () => {
    const source = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://s3.example/presigned-upload" }), { status: 200 }),
      )
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("PUT");
        expect(init?.headers).toEqual({ "Content-Type": "video/mp4" });
        expect(init?.body).toBeInstanceOf(Blob);
        expect(Buffer.from(await (init?.body as Blob).arrayBuffer())).toEqual(source);
        return new Response(null, { status: 200 });
      });
    globalThis.fetch = fetchMock as typeof fetch;

    const output = await storagePut("users/1/video-editor/sources/clip.mp4", source, "video/mp4");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.key).toMatch(/^users\/1\/video-editor\/sources\/clip_[a-f0-9]{8}\.mp4$/);
    expect(output.url).toBe(`/manus-storage/${output.key}`);
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
