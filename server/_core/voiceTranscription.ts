import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { getOpenAiCompatibleUrl, runtimeConfig } from "../runtimeConfig";

export type WhisperSegment = { id: number; start: number; end: number; text: string; [key: string]: unknown };
export type WhisperResponse = { task?: "transcribe"; language?: string; duration?: number; text: string; segments: WhisperSegment[] };
export type TranscriptionResponse = WhisperResponse;
export type TranscriptionError = { error: string; code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR"; details?: string };
export type TranscribeOptions = { audioUrl: string; language?: string; prompt?: string };

function extensionFor(mimeType: string): string {
  return ({ "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/mp4": "m4a" } as Record<string, string>)[mimeType] ?? "mp3";
}

async function readAudio(url: string): Promise<{ data: Buffer; mimeType: string }> {
  if (url.startsWith("file:")) return { data: await fs.readFile(fileURLToPath(url)), mimeType: "audio/mpeg" };
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") ?? "audio/mpeg" };
}

export async function transcribeAudio(options: TranscribeOptions): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    if (!runtimeConfig.transcription.baseUrl) {
      return { error: "Voice transcription is not configured", code: "SERVICE_ERROR", details: "Set CINEFLOW_TRANSCRIPTION_BASE_URL to an OpenAI-compatible transcription endpoint." };
    }
    const { data, mimeType } = await readAudio(options.audioUrl);
    if (data.length > 16 * 1024 * 1024) return { error: "Audio file exceeds maximum size limit", code: "FILE_TOO_LARGE" };
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), `audio.${extensionFor(mimeType)}`);
    formData.append("model", runtimeConfig.transcription.model);
    formData.append("response_format", "verbose_json");
    if (options.language) formData.append("language", options.language);
    if (options.prompt) formData.append("prompt", options.prompt);
    const response = await fetch(getOpenAiCompatibleUrl(runtimeConfig.transcription.baseUrl, "audio/transcriptions"), {
      method: "POST",
      headers: runtimeConfig.transcription.apiKey ? { Authorization: `Bearer ${runtimeConfig.transcription.apiKey}` } : {},
      body: formData,
    });
    if (!response.ok) return { error: "Transcription service request failed", code: "TRANSCRIPTION_FAILED", details: `${response.status} ${await response.text().catch(() => response.statusText)}` };
    const result = await response.json() as Partial<WhisperResponse>;
    if (typeof result.text !== "string") return { error: "Invalid transcription response", code: "SERVICE_ERROR" };
    return { text: result.text, segments: Array.isArray(result.segments) ? result.segments : [], task: result.task, language: result.language, duration: result.duration };
  } catch (error) {
    return { error: "Voice transcription failed", code: "SERVICE_ERROR", details: error instanceof Error ? error.message : "Unexpected error" };
  }
}
