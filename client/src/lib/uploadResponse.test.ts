import { describe, expect, it } from "vitest";
import { readVideoUploadResponse } from "./uploadResponse";

describe("readVideoUploadResponse", () => {
  it("returns parsed JSON for a successful upload response", async () => {
    const result = await readVideoUploadResponse(new Response(JSON.stringify({ clip: { id: 24 } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));

    expect(result.clip).toEqual({ id: 24 });
  });

  it("shows a readable message when a gateway returns HTML", async () => {
    await expect(readVideoUploadResponse(new Response("<html><h1>403 Forbidden</h1></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    }))).rejects.toThrow("เกตเวย์อัปโหลดปฏิเสธคำขอ");
  });

  it("keeps a JSON API error message", async () => {
    await expect(readVideoUploadResponse(new Response(JSON.stringify({ error: "Video exceeds the 180 MB upload limit" }), {
      status: 413,
      headers: { "content-type": "application/json" },
    }))).rejects.toThrow("Video exceeds the 180 MB upload limit");
  });
});
