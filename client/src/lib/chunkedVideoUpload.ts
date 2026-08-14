import { readJsonResponse } from "./uploadResponse";

export const VIDEO_UPLOAD_PART_BYTES = 4 * 1024 * 1024;

type UploadStart = { uploadId: string; partBytes: number };
type UploadResult<TProject, TClip> = { project?: TProject; clip?: TClip };

export async function uploadVideoInParts<TProject, TClip>(input: {
  file: File;
  projectId?: number;
  headers: Record<string, string>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult<TProject, TClip>> {
  const totalParts = Math.ceil(input.file.size / VIDEO_UPLOAD_PART_BYTES);
  let uploadId: string | undefined;
  try {
    const start = await readJsonResponse<UploadStart>(await fetch("/api/video-uploads", {
      method: "POST",
      headers: { ...input.headers, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: input.file.name,
        mimeType: input.file.type || "video/mp4",
        totalBytes: input.file.size,
        totalParts,
        projectId: input.projectId,
      }),
      signal: input.signal,
    }));
    uploadId = start.uploadId;

    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const startByte = partIndex * start.partBytes;
      const part = input.file.slice(startByte, Math.min(startByte + start.partBytes, input.file.size));
      await readJsonResponse(await fetch(`/api/video-uploads/${encodeURIComponent(start.uploadId)}/parts/${partIndex}`, {
        method: "PUT",
        headers: { ...input.headers, "content-type": "application/octet-stream" },
        body: part,
        signal: input.signal,
      }));
      input.onProgress?.(Math.round(((partIndex + 1) / totalParts) * 90));
    }

    input.onProgress?.(95);
    const completed = await readJsonResponse<UploadResult<TProject, TClip>>(await fetch(`/api/video-uploads/${encodeURIComponent(start.uploadId)}/complete`, {
      method: "POST",
      headers: { ...input.headers, "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: input.signal,
    }));
    input.onProgress?.(100);
    return completed;
  } catch (error) {
    if (!input.signal?.aborted) throw error;
    if (uploadId) {
      await fetch(`/api/video-uploads/${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
        headers: input.headers,
      }).catch(() => undefined);
    }
    throw new Error("อัปโหลดถูกยกเลิก");
  }
}
