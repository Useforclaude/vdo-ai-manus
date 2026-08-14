import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadVideoInParts, VIDEO_UPLOAD_PART_BYTES } from "./chunkedVideoUpload";

describe("uploadVideoInParts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads a video in gateway-safe parts then completes the session", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/video-uploads") return new Response(JSON.stringify({ uploadId: "upload_1234567890abcdef1234567890abcdef", partBytes: VIDEO_UPLOAD_PART_BYTES }), { status: 201 });
      if (url.endsWith("/complete")) return new Response(JSON.stringify({ project: { id: 7 }, clip: { id: 9 } }), { status: 201 });
      return new Response(JSON.stringify({ received: 0 }), { status: 201 });
    }));

    const file = new File([new Uint8Array(VIDEO_UPLOAD_PART_BYTES + 9)], "clip.mp4", { type: "video/mp4" });
    const progress: number[] = [];
    const result = await uploadVideoInParts<{ id: number }, { id: number }>({ file, headers: { "x-test": "guest" }, onProgress: value => progress.push(value) });

    expect(result).toEqual({ project: { id: 7 }, clip: { id: 9 } });
    expect(requests.map(request => request.url)).toEqual([
      "/api/video-uploads",
      "/api/video-uploads/upload_1234567890abcdef1234567890abcdef/parts/0",
      "/api/video-uploads/upload_1234567890abcdef1234567890abcdef/parts/1",
      "/api/video-uploads/upload_1234567890abcdef1234567890abcdef/complete",
    ]);
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ fileName: "clip.mp4", totalBytes: VIDEO_UPLOAD_PART_BYTES + 9, totalParts: 2 });
    expect((requests[1].init?.body as Blob).size).toBe(VIDEO_UPLOAD_PART_BYTES);
    expect((requests[2].init?.body as Blob).size).toBe(9);
    expect(progress).toEqual([45, 90, 95, 100]);
  });

  it("cancels the server session after an aborted part request", async () => {
    const abortController = new AbortController();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/video-uploads") return new Response(JSON.stringify({ uploadId: "upload_1234567890abcdef1234567890abcdef", partBytes: VIDEO_UPLOAD_PART_BYTES }), { status: 201 });
      if (url.includes("/parts/0")) {
        abortController.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }));

    const file = new File([new Uint8Array(16)], "clip.mp4", { type: "video/mp4" });
    await expect(uploadVideoInParts({ file, headers: { "x-test": "guest" }, signal: abortController.signal })).rejects.toThrow("อัปโหลดถูกยกเลิก");

    expect(requests.map(request => request.url)).toEqual([
      "/api/video-uploads",
      "/api/video-uploads/upload_1234567890abcdef1234567890abcdef/parts/0",
      "/api/video-uploads/upload_1234567890abcdef1234567890abcdef",
    ]);
    expect(requests[2].init).toMatchObject({ method: "DELETE", headers: { "x-test": "guest" } });
  });
});
