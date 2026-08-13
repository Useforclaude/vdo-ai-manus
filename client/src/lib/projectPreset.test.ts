import { describe, expect, it } from "vitest";
import { buildProjectPreset, parseProjectPreset } from "./projectPreset";

describe("project preset", () => {
  it("creates a portable timeline preset without video URLs or storage identifiers", () => {
    const preset = buildProjectPreset({
      command: "ตัดช่วงเงียบทั้งหมด แล้วสร้างซับไตเติล",
      subtitleStyle: { font: "Noto Sans Thai", size: "large", position: "middle" },
      clips: [{ sourceName: "intro.mp4", occurrence: 1, trimStartMs: 500, trimEndMs: 4000 }],
    });

    expect(preset).toMatchObject({ format: "cineflow-project-preset", version: 1, clips: [{ sourceName: "intro.mp4", trimStartMs: 500 }] });
    expect(JSON.stringify(preset)).not.toMatch(/storageKey|storageUrl|https?:\/\//);
  });

  it("accepts only the known, bounded preset format", () => {
    const parsed = parseProjectPreset({
      format: "cineflow-project-preset",
      version: 1,
      exportedAt: "2026-08-13T00:00:00.000Z",
      command: "Remove silence",
      subtitleStyle: { font: "Inter", size: "small", position: "bottom" },
      clips: [{ sourceName: "clip.mp4", occurrence: 1, trimStartMs: null, trimEndMs: null }],
    });

    expect(parsed.subtitleStyle.font).toBe("Inter");
    expect(() => parseProjectPreset({ ...parsed, storageUrl: "https://untrusted.example/video.mp4" })).toThrow();
    expect(() => parseProjectPreset({ ...parsed, clips: [] })).toThrow();
  });
});
