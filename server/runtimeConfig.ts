import path from "node:path";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function getOpenAiCompatibleUrl(baseUrl: string, endpoint: string): string {
  return new URL(endpoint.replace(/^\/+/, ""), withTrailingSlash(baseUrl)).toString();
}

export const runtimeConfig = {
  app: {
    publicUrl: optional("CINEFLOW_PUBLIC_URL"),
    cookieSecure: process.env.CINEFLOW_COOKIE_SECURE === "true",
  },
  storage: {
    driver: (optional("CINEFLOW_STORAGE_DRIVER") ?? "local").toLowerCase(),
    localPath: path.resolve(optional("CINEFLOW_LOCAL_STORAGE_PATH") ?? "./data/storage"),
    bucket: optional("S3_BUCKET"),
    region: optional("S3_REGION") ?? "us-east-1",
    endpoint: optional("S3_ENDPOINT"),
    accessKeyId: optional("S3_ACCESS_KEY_ID"),
    secretAccessKey: optional("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  },
  llm: {
    baseUrl: optional("CINEFLOW_LLM_BASE_URL"),
    apiKey: optional("CINEFLOW_LLM_API_KEY"),
    defaultModel: optional("CINEFLOW_LLM_DEFAULT_MODEL") ?? "local-model",
  },
  transcription: {
    baseUrl: optional("CINEFLOW_TRANSCRIPTION_BASE_URL"),
    apiKey: optional("CINEFLOW_TRANSCRIPTION_API_KEY"),
    model: optional("CINEFLOW_TRANSCRIPTION_MODEL") ?? "whisper-1",
  },
} as const;

type S3Configuration = {
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function requireS3Config(storage: S3Configuration = runtimeConfig.storage) {
  const { bucket, accessKeyId, secretAccessKey } = storage;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.");
  }
  return { bucket, accessKeyId, secretAccessKey };
}
