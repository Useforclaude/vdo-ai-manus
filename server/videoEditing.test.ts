import { describe, expect, it } from "vitest";
import { createSrt, fallbackPlan } from "./videoEditing";
import { completeVideoJob, failVideoJob, initialVideoJobState, startVideoJob, updateVideoJobProgress } from "./videoJobState";

describe("fallbackPlan", () => {
  it("maps a Thai command into silence removal and subtitles", () => {
    const plan = fallbackPlan("ตัดช่วงเงียบทั้งหมด แล้วสร้างซับไตเติล");
    expect(plan.sourceLanguage).toBe("th");
    expect(plan.operations).toEqual([
      { type: "remove_silence" },
      { type: "generate_subtitles" },
    ]);
  });

  it("maps an English first-duration command into a trim operation", () => {
    const plan = fallbackPlan("Keep the first 30 seconds and crop to 16:9");
    expect(plan.operations).toContainEqual({ type: "trim", startSeconds: 0, endSeconds: 30 });
    expect(plan.operations).toContainEqual({ type: "crop_16_9" });
  });
});

describe("createSrt", () => {
  it("writes standard SRT timestamps with subtitle text", () => {
    const srt = createSrt([{
      id: 0,
      seek: 0,
      start: 1.25,
      end: 3.5,
      text: " สวัสดีครับ ",
      tokens: [],
      temperature: 0,
      avg_logprob: 0,
      compression_ratio: 1,
      no_speech_prob: 0,
    }]);
    expect(srt).toContain("00:00:01,250 --> 00:00:03,500");
    expect(srt).toContain("สวัสดีครับ");
  });
});

describe("video job states", () => {
  it("transitions a queued job through processing and complete with bounded progress", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(initialVideoJobState).toEqual({ status: "queued", progress: 0 });
    expect(startVideoJob(now)).toMatchObject({ status: "processing", progress: 5, startedAt: now, errorMessage: null });
    expect(updateVideoJobProgress(53.7)).toEqual({ progress: 54 });
    expect(updateVideoJobProgress(250)).toEqual({ progress: 94 });
    expect(completeVideoJob("users/1/edited.mp4", "https://example.test/edited.mp4", now)).toMatchObject({ status: "complete", progress: 100, completedAt: now });
  });

  it("records a bounded error message when a job fails", () => {
    const failed = failVideoJob("x".repeat(2500), new Date("2026-08-13T00:00:00.000Z"));
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toHaveLength(2000);
  });
});
