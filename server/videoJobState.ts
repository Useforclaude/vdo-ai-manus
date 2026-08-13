export type VideoJobStatus = "queued" | "processing" | "complete" | "failed";

export const initialVideoJobState = {
  status: "queued" as const,
  progress: 0,
};

export function startVideoJob(now = new Date()) {
  return {
    status: "processing" as const,
    progress: 5,
    errorMessage: null,
    startedAt: now,
  };
}

export function updateVideoJobProgress(progress: number) {
  return { progress: Math.max(5, Math.min(94, Math.round(progress))) };
}

export function completeVideoJob(processedStorageKey: string, processedUrl: string, now = new Date()) {
  return {
    status: "complete" as const,
    progress: 100,
    processedStorageKey,
    processedUrl,
    completedAt: now,
  };
}

export function failVideoJob(message: string, now = new Date()) {
  return {
    status: "failed" as const,
    errorMessage: message.slice(0, 2000),
    completedAt: now,
  };
}
