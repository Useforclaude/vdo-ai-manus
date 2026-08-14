import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import * as db from "./db";
import { runtimeConfig } from "./runtimeConfig";

export const ADMIN_COOKIE_NAME = "cineflow_admin";
const AI_PROVIDER_KEY = "ai_provider";
const STORAGE_KEY = "storage_provider";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type AiProviderConfig = {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmDefaultModel?: string;
  transcriptionBaseUrl?: string;
  transcriptionApiKey?: string;
  transcriptionModel?: string;
};

export type StorageProviderConfig = {
  driver: "local" | "s3";
  localPath?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

export type RuntimeProviderConfig = {
  ai: Required<Omit<AiProviderConfig, "llmApiKey" | "transcriptionApiKey">> & Pick<AiProviderConfig, "llmApiKey" | "transcriptionApiKey">;
  storage: Required<Omit<StorageProviderConfig, "bucket" | "endpoint" | "accessKeyId" | "secretAccessKey">> & Pick<StorageProviderConfig, "bucket" | "endpoint" | "accessKeyId" | "secretAccessKey">;
};

function encryptionKey(): Buffer | undefined {
  const secret = process.env.CINEFLOW_CONFIG_ENCRYPTION_KEY?.trim();
  return secret ? createHash("sha256").update(secret).digest() : undefined;
}

export function isConfigurationEncryptionReady(): boolean {
  return Boolean(encryptionKey());
}

function encrypt(value: unknown): string {
  const key = encryptionKey();
  if (!key) throw new Error("Configuration encryption is unavailable. Set CINEFLOW_CONFIG_ENCRYPTION_KEY before saving provider credentials.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
}

function decrypt<T>(encoded?: string): T | undefined {
  if (!encoded) return undefined;
  const key = encryptionKey();
  if (!key) return undefined;
  const [version, ivEncoded, tagEncoded, payloadEncoded] = encoded.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !payloadEncoded) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const value = Buffer.concat([decipher.update(Buffer.from(payloadEncoded, "base64url")), decipher.final()]);
    return JSON.parse(value.toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readSetting<T>(key: string): Promise<T | undefined> {
  return decrypt<T>((await db.getSystemSetting(key))?.encryptedValue);
}

function aiDefaults(): RuntimeProviderConfig["ai"] {
  return {
    llmBaseUrl: runtimeConfig.llm.baseUrl ?? "",
    llmApiKey: runtimeConfig.llm.apiKey,
    llmDefaultModel: runtimeConfig.llm.defaultModel,
    transcriptionBaseUrl: runtimeConfig.transcription.baseUrl ?? "",
    transcriptionApiKey: runtimeConfig.transcription.apiKey,
    transcriptionModel: runtimeConfig.transcription.model,
  };
}

function storageDefaults(): RuntimeProviderConfig["storage"] {
  return {
    driver: runtimeConfig.storage.driver === "s3" ? "s3" : "local",
    localPath: runtimeConfig.storage.localPath,
    bucket: runtimeConfig.storage.bucket,
    region: runtimeConfig.storage.region,
    endpoint: runtimeConfig.storage.endpoint,
    accessKeyId: runtimeConfig.storage.accessKeyId,
    secretAccessKey: runtimeConfig.storage.secretAccessKey,
    forcePathStyle: runtimeConfig.storage.forcePathStyle,
  };
}

export async function getRuntimeProviderConfig(): Promise<RuntimeProviderConfig> {
  const [savedAi, savedStorage] = await Promise.all([readSetting<AiProviderConfig>(AI_PROVIDER_KEY), readSetting<StorageProviderConfig>(STORAGE_KEY)]);
  return {
    ai: { ...aiDefaults(), ...savedAi },
    storage: { ...storageDefaults(), ...savedStorage },
  };
}

export async function saveProviderConfiguration(input: { ai: AiProviderConfig; storage: StorageProviderConfig }): Promise<void> {
  if (!isConfigurationEncryptionReady()) {
    throw new Error("Configuration encryption is unavailable. Set CINEFLOW_CONFIG_ENCRYPTION_KEY before saving provider credentials.");
  }
  const [savedAi, savedStorage] = await Promise.all([readSetting<AiProviderConfig>(AI_PROVIDER_KEY), readSetting<StorageProviderConfig>(STORAGE_KEY)]);
  const clean = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
  const nextAi = { ...savedAi, ...clean(input.ai) };
  const nextStorage = { ...savedStorage, ...clean(input.storage) };
  await Promise.all([
    db.upsertSystemSetting(AI_PROVIDER_KEY, encrypt(nextAi)),
    db.upsertSystemSetting(STORAGE_KEY, encrypt(nextStorage)),
  ]);
}

function maskSecret(value?: string): string | null {
  return value ? `••••${value.slice(-4)}` : null;
}

export async function getPublicProviderConfiguration() {
  const config = await getRuntimeProviderConfig();
  return {
    encryptionReady: isConfigurationEncryptionReady(),
    ai: {
      llmBaseUrl: config.ai.llmBaseUrl,
      llmDefaultModel: config.ai.llmDefaultModel,
      llmApiKey: maskSecret(config.ai.llmApiKey),
      transcriptionBaseUrl: config.ai.transcriptionBaseUrl,
      transcriptionModel: config.ai.transcriptionModel,
      transcriptionApiKey: maskSecret(config.ai.transcriptionApiKey),
    },
    storage: {
      driver: config.storage.driver,
      localPath: config.storage.localPath,
      bucket: config.storage.bucket,
      region: config.storage.region,
      endpoint: config.storage.endpoint,
      accessKeyId: maskSecret(config.storage.accessKeyId),
      secretAccessKey: maskSecret(config.storage.secretAccessKey),
      forcePathStyle: config.storage.forcePathStyle,
    },
  };
}

function secureCookie(req: Request): boolean {
  return runtimeConfig.app.cookieSecure || req.secure || req.get("x-forwarded-proto") === "https";
}

function adminSigningSecret(): string | undefined {
  return process.env.CINEFLOW_ADMIN_SESSION_SECRET?.trim() || process.env.CINEFLOW_ADMIN_TOKEN?.trim();
}

export function isAdminSession(req: Request): boolean {
  const secret = adminSigningSecret();
  const value = parse(req.headers.cookie ?? "")[ADMIN_COOKIE_NAME];
  if (!secret || !value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    return Number(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).expiresAt) > Date.now();
  } catch {
    return false;
  }
}

export function unlockAdminSession(req: Request, res: Response, token: string): boolean {
  const expected = process.env.CINEFLOW_ADMIN_TOKEN?.trim();
  if (!expected || expected.length !== token.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return false;
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + ADMIN_SESSION_TTL_MS })).toString("base64url");
  const secret = adminSigningSecret();
  if (!secret) return false;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  res.cookie(ADMIN_COOKIE_NAME, `${payload}.${signature}`, { httpOnly: true, secure: secureCookie(req), sameSite: "strict", path: "/", maxAge: ADMIN_SESSION_TTL_MS });
  return true;
}

export function lockAdminSession(req: Request, res: Response): void {
  res.clearCookie(ADMIN_COOKIE_NAME, { httpOnly: true, secure: secureCookie(req), sameSite: "strict", path: "/" });
}
