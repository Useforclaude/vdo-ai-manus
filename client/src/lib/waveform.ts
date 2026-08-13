export type WaveformPeaks = readonly number[];

/**
 * Decodes an already-authorized video URL in the browser and compresses its
 * first audio channel into a compact, display-ready peak array. It is only an
 * editing aid: the persisted trim and final render remain server-side.
 */
export async function extractWaveformPeaks(sourceUrl: string, bins = 96, signal?: AbortSignal): Promise<WaveformPeaks> {
  const response = await fetch(sourceUrl, { signal });
  if (!response.ok) throw new Error("Unable to read the selected clip audio");

  const audioContext = new AudioContext();
  try {
    const buffer = await response.arrayBuffer();
    if (signal?.aborted) throw new DOMException("Waveform request cancelled", "AbortError");
    const decoded = await audioContext.decodeAudioData(buffer);
    if (!decoded.numberOfChannels || !decoded.length) return [];

    const samples = decoded.getChannelData(0);
    const samplesPerBin = Math.max(1, Math.ceil(samples.length / bins));
    const peaks: number[] = [];

    for (let bin = 0; bin < bins; bin += 1) {
      const start = bin * samplesPerBin;
      const end = Math.min(samples.length, start + samplesPerBin);
      if (start >= samples.length) {
        peaks.push(0);
        continue;
      }

      let peak = 0;
      for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index] ?? 0));
      peaks.push(Math.min(1, peak));
    }

    return peaks;
  } finally {
    await audioContext.close();
  }
}
