export type VideoUploadResponse = {
  project?: unknown;
  clip?: unknown;
  error?: string;
};

export async function readVideoUploadResponse(response: Response): Promise<VideoUploadResponse> {
  const body = await response.text();
  let data: VideoUploadResponse;

  try {
    data = JSON.parse(body) as VideoUploadResponse;
  } catch {
    const status = response.status || 0;
    const isGatewayRejection = status === 403 || status === 413 || status === 502 || status === 503;
    const detail = isGatewayRejection
      ? "เกตเวย์อัปโหลดปฏิเสธคำขอ โปรดลองอัปโหลดใหม่อีกครั้ง"
      : "บริการอัปโหลดตอบกลับผิดรูปแบบ";
    throw new Error(`${detail} (HTTP ${status})`);
  }

  if (!response.ok) {
    throw new Error(data.error ?? `อัปโหลดวิดีโอไม่สำเร็จ (HTTP ${response.status})`);
  }

  return data;
}
