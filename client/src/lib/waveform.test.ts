import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWaveformPeaks } from "./waveform";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockAudioDecoder(samples: number[], channelCount = 1) {
  const close = vi.fn().mockResolvedValue(undefined);
  const decodeAudioData = vi.fn().mockResolvedValue({
    numberOfChannels: channelCount,
    length: samples.length,
    getChannelData: vi.fn(() => new Float32Array(samples)),
  });
  vi.stubGlobal("AudioContext", vi.fn(() => ({ decodeAudioData, close })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }));
  return { close, decodeAudioData };
}

describe("extractWaveformPeaks", () => {
  it("compresses first-channel amplitudes into normalized display peaks", async () => {
    const audio = mockAudioDecoder([0, -0.5, 0.2, -0.9, 0.1, -0.3, 0.4, -1.2]);

    const peaks = await extractWaveformPeaks("https://example.test/clip.mp4", 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.5, 5);
    expect(peaks[1]).toBeCloseTo(0.9, 5);
    expect(peaks[2]).toBeCloseTo(0.3, 5);
    expect(peaks[3]).toBe(1);

    expect(audio.decodeAudioData).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("returns no peaks when decoded media has no audio channel", async () => {
    const audio = mockAudioDecoder([], 0);

    await expect(extractWaveformPeaks("https://example.test/silent.mp4")).resolves.toEqual([]);

    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("honors an aborted request after download without leaving the audio context open", async () => {
    const audio = mockAudioDecoder([0.4, 0.2]);
    const controller = new AbortController();
    controller.abort();

    await expect(extractWaveformPeaks("https://example.test/clip.mp4", 8, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

    expect(audio.decodeAudioData).not.toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalledOnce();
  });
});
