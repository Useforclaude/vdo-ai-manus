import { spawn } from "child_process";
import { createWriteStream, promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { nanoid } from "nanoid";
import type { EditPlan } from "../shared/editing";
import * as db from "./db";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { transcribeAudio, type WhisperSegment } from "./_core/voiceTranscription";
import { storageGetSignedUrl, storagePut } from "./storage";
import { completeVideoJob, failVideoJob, startVideoJob, updateVideoJobProgress } from "./videoJobState";

const MAX_SOURCE_BYTES = 180 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = 16 * 1024 * 1024;
const SILENCE_NOISE = "-35dB";
const SILENCE_DURATION = "0.4";

const planSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "video_edit_plan",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sourceLanguage: { type: "string", enum: ["th", "en", "mixed", "unknown"] },
        summary: { type: "string" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["remove_silence", "trim", "crop_16_9", "generate_subtitles"] },
              startSeconds: { type: "number" },
              endSeconds: { type: "number" },
            },
            required: ["type"],
            additionalProperties: false,
          },
        },
      },
      required: ["sourceLanguage", "summary", "operations"],
      additionalProperties: false,
    },
  },
};

export function fallbackPlan(command: string): EditPlan {
  const normalized = command.toLowerCase();
  const operations: EditPlan["operations"] = [];
  if (/เงียบ|silence|dead air/.test(normalized)) operations.push({ type: "remove_silence" });
  if (/ซับ|subtitle|srt|caption/.test(normalized)) operations.push({ type: "generate_subtitles" });
  if (/16\s*:\s*9|ครอป|crop/.test(normalized)) operations.push({ type: "crop_16_9" });
  const seconds = normalized.match(/(\d+(?:\.\d+)?)\s*(?:วินาที|second|sec)/)?.[1];
  if (seconds) operations.push({ type: "trim", startSeconds: 0, endSeconds: Number(seconds) });
  return {
    sourceLanguage: /[ก-๙]/.test(command) && /[a-z]/i.test(command) ? "mixed" : /[ก-๙]/.test(command) ? "th" : "en",
    summary: operations.length ? "Editing plan prepared from your command." : "No supported edit operation was detected.",
    operations,
  };
}

function validatePlan(raw: EditPlan, fallback: EditPlan): EditPlan {
  const allowed = new Set(["remove_silence", "trim", "crop_16_9", "generate_subtitles"]);
  const operations = (raw.operations ?? []).filter(operation => allowed.has(operation.type)).map(operation => {
    const startSeconds = typeof operation.startSeconds === "number" ? Math.max(0, operation.startSeconds) : undefined;
    const requestedEnd = typeof operation.endSeconds === "number" ? Math.max(0, operation.endSeconds) : undefined;
    const endSeconds = startSeconds !== undefined && requestedEnd !== undefined ? Math.max(startSeconds + 0.1, requestedEnd) : requestedEnd;
    return {
      type: operation.type,
      ...(startSeconds !== undefined ? { startSeconds } : {}),
      ...(endSeconds !== undefined ? { endSeconds } : {}),
    };
  }) as EditPlan["operations"];
  return {
    sourceLanguage: ["th", "en", "mixed", "unknown"].includes(raw.sourceLanguage) ? raw.sourceLanguage : fallback.sourceLanguage,
    summary: raw.summary?.trim().slice(0, 280) || fallback.summary,
    operations: operations.length ? operations : fallback.operations,
  };
}

export async function interpretVideoCommand(command: string): Promise<EditPlan> {
  const fallback = fallbackPlan(command);
  try {
    const { data: models } = await listLLMModels();
    const model = models.find(modelInfo => modelInfo.id === "gpt-5-mini")?.id ?? models[0]?.id;
    if (!model) return fallback;
    const response = await invokeLLM({
      model,
      maxTokens: 650,
      response_format: planSchema,
      messages: [
        {
          role: "system",
          content: "You interpret video-editing requests in Thai and English. Return only operations supported by the schema. For a command asking for the first N seconds, use trim with startSeconds 0 and endSeconds N. Never invent timestamps when the request does not provide them.",
        },
        { role: "user", content: command },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string") return fallback;
    const parsed = JSON.parse(content) as EditPlan;
    return validatePlan(parsed, fallback);
  } catch (error) {
    console.warn("[Video] Falling back to deterministic command interpretation", error);
    return fallback;
  }
}

function commandExists(plan: EditPlan, type: EditPlan["operations"][number]["type"]) {
  return plan.operations.some(operation => operation.type === type);
}

function trimOperation(plan: EditPlan) {
  return plan.operations.find(operation => operation.type === "trim");
}

function runBinary(binary: string, args: string[], onLine?: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const task = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    task.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line: string) => onLine?.(line));
    });
    task.on("error", reject);
    task.on("close", code => code === 0 ? resolve() : reject(new Error(`${binary} exited with code ${code}: ${stderr.slice(-1500)}`)));
  });
}

async function probeDuration(filePath: string) {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const task = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    task.stdout.on("data", chunk => { output += chunk.toString(); });
    task.on("error", reject);
    task.on("close", code => code === 0 ? resolve() : reject(new Error("Unable to read video duration")));
  });
  return Math.max(1, Number.parseFloat(output) || 1);
}

async function downloadToFile(url: string, destination: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("Unable to download the source video");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_SOURCE_BYTES) throw new Error("Video exceeds the 180 MB processing limit");
  const output = createWriteStream(destination);
  const input = Readable.fromWeb(response.body as never);
  await finished(input.pipe(output));
  const stats = await fs.stat(destination);
  if (stats.size > MAX_SOURCE_BYTES) throw new Error("Video exceeds the 180 MB processing limit");
}

async function findKeepIntervals(inputPath: string, duration: number) {
  const starts: number[] = [];
  const ends: number[] = [];
  await runBinary("ffmpeg", ["-hide_banner", "-i", inputPath, "-af", `silencedetect=noise=${SILENCE_NOISE}:d=${SILENCE_DURATION}`, "-f", "null", "-"], line => {
    const start = line.match(/silence_start:\s*([\d.]+)/)?.[1];
    const end = line.match(/silence_end:\s*([\d.]+)/)?.[1];
    if (start) starts.push(Number(start));
    if (end) ends.push(Number(end));
  });
  const silences = starts.map((start, index) => [start, ends[index] ?? duration] as const).filter(([start, end]) => end > start);
  const intervals: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of silences) {
    if (start - cursor > 0.08) intervals.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (duration - cursor > 0.08) intervals.push([cursor, duration]);
  return intervals.length ? intervals : [[0, duration] as [number, number]];
}

function srtTime(seconds: number) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function createSrt(segments: WhisperSegment[]) {
  return segments.map((segment, index) => `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.text.trim()}\n`).join("\n");
}

async function createSubtitle(jobId: string, inputPath: string, userId: number) {
  const audioPath = path.join(path.dirname(inputPath), "whisper-audio.mp3");
  await runBinary("ffmpeg", ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", audioPath]);
  const audio = await fs.readFile(audioPath);
  if (audio.length > MAX_TRANSCRIPTION_BYTES) throw new Error("Audio is too long for subtitle generation; the extracted track exceeds the 16 MB transcription limit");
  const uploadedAudio = await storagePut(`users/${userId}/video-editor/${jobId}/transcription-audio.mp3`, audio, "audio/mpeg");
  const transcription = await transcribeAudio({ audioUrl: await storageGetSignedUrl(uploadedAudio.key) });
  if ("error" in transcription) throw new Error(transcription.error);
  const srt = createSrt(transcription.segments);
  return storagePut(`users/${userId}/video-editor/${jobId}/subtitles.srt`, srt, "application/x-subrip");
}

function applyBasicFilters(args: string[], plan: EditPlan) {
  const trim = trimOperation(plan);
  if (trim?.startSeconds !== undefined) args.push("-ss", String(trim.startSeconds));
  args.push("-i", "INPUT");
  if (trim?.endSeconds !== undefined) args.push("-to", String(trim.endSeconds));
  if (commandExists(plan, "crop_16_9")) {
    args.push("-vf", "crop=if(gte(a\\,16/9)\\,ih*16/9\\,iw):if(gte(a\\,16/9)\\,ih\\,iw*9/16)");
  }
  return args;
}

async function renderVideo(inputPath: string, outputPath: string, plan: EditPlan, totalDuration: number, onProgress: (progress: number) => void) {
  if (commandExists(plan, "remove_silence")) {
    const intervals = await findKeepIntervals(inputPath, totalDuration);
    const trim = trimOperation(plan);
    const bounded = intervals.map(([start, end]) => [Math.max(start, trim?.startSeconds ?? 0), Math.min(end, trim?.endSeconds ?? totalDuration)] as const).filter(([start, end]) => end > start);
    if (!bounded.length) throw new Error("The specified time range contains no editable video");
    const chains = bounded.flatMap(([start, end], index) => [
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
    ]);
    const concatInputs = bounded.map((_, index) => `[v${index}][a${index}]`).join("");
    const crop = commandExists(plan, "crop_16_9") ? ";[concatv]crop=if(gte(a\\,16/9)\\,ih*16/9\\,iw):if(gte(a\\,16/9)\\,ih\\,iw*9/16)[video]" : ";[concatv]null[video]";
    const filter = `${chains.join(";")};${concatInputs}concat=n=${bounded.length}:v=1:a=1[concatv][concata]${crop}`;
    await runBinary("ffmpeg", ["-y", "-i", inputPath, "-filter_complex", filter, "-map", "[video]", "-map", "[concata]", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", "-progress", "pipe:2", "-nostats", outputPath], line => {
      const outTime = Number(line.match(/^out_time_ms=(\d+)/)?.[1] ?? 0) / 1_000_000;
      if (outTime) onProgress(Math.min(94, Math.max(35, Math.floor(30 + outTime / totalDuration * 60))));
    });
    return;
  }
  const args = applyBasicFilters(["-y"], plan).map(value => value === "INPUT" ? inputPath : value);
  args.push("-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", "-progress", "pipe:2", "-nostats", outputPath);
  await runBinary("ffmpeg", args, line => {
    const outTime = Number(line.match(/^out_time_ms=(\d+)/)?.[1] ?? 0) / 1_000_000;
    if (outTime) onProgress(Math.min(94, Math.max(35, Math.floor(30 + outTime / totalDuration * 60))));
  });
}

const activeJobs = new Set<string>();

export async function processVideoJob(jobId: string, userId: number) {
  if (activeJobs.has(jobId)) return db.getEditJobForUser(jobId, userId);
  const job = await db.getEditJobForUser(jobId, userId);
  if (!job) throw new Error("Editing job was not found");
  if (job.status === "processing") return job;
  const project = await db.getVideoProjectForUser(job.projectId, userId);
  if (!project) throw new Error("Source video was not found");
  const workspace = await fs.mkdtemp(path.join(tmpdir(), "vdo-command-"));
  const inputPath = path.join(workspace, "source.mp4");
  const outputPath = path.join(workspace, "edited.mp4");
  activeJobs.add(jobId);
  try {
    await db.updateEditJob(jobId, userId, startVideoJob());
    await downloadToFile(await storageGetSignedUrl(project.sourceStorageKey), inputPath);
    const duration = await probeDuration(inputPath);
    await db.updateVideoProjectDuration(project.id, userId, Math.ceil(duration));
    await db.updateEditJob(jobId, userId, updateVideoJobProgress(24));
    const plan = job.operationPlan as EditPlan;
    let subtitle: { key: string; url: string } | undefined;
    if (commandExists(plan, "generate_subtitles")) {
      subtitle = await createSubtitle(jobId, inputPath, userId);
      await db.updateEditJob(jobId, userId, { ...updateVideoJobProgress(45), subtitleStorageKey: subtitle.key, subtitleUrl: subtitle.url });
    }
    const needsRender = commandExists(plan, "remove_silence") || commandExists(plan, "trim") || commandExists(plan, "crop_16_9");
    let video: { key: string; url: string } | undefined;
    if (needsRender) {
      let progressWrite = Promise.resolve();
      await renderVideo(inputPath, outputPath, plan, duration, progress => {
        progressWrite = progressWrite.then(() => db.updateEditJob(jobId, userId, updateVideoJobProgress(progress)).then(() => undefined));
      });
      await progressWrite;
      video = await storagePut(`users/${userId}/video-editor/${jobId}/edited.mp4`, await fs.readFile(outputPath), "video/mp4");
    }
    await db.updateEditJob(jobId, userId, completeVideoJob(video?.key ?? project.sourceStorageKey, video?.url ?? project.sourceUrl));
    return await db.getEditJobForUser(jobId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected video-processing error";
    await db.updateEditJob(jobId, userId, failVideoJob(message));
    throw error;
  } finally {
    activeJobs.delete(jobId);
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export function createJobId() {
  return `job_${nanoid(16)}`;
}

export { MAX_SOURCE_BYTES };
