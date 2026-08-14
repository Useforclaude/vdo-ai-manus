import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireS3Config } from "./runtimeConfig";
import { getRuntimeProviderConfig, type RuntimeProviderConfig } from "./systemConfig";

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!key || key.split("/").some(part => part === "..")) throw new Error("Invalid storage key");
  return key;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function isS3(storage: RuntimeProviderConfig["storage"]): boolean {
  return storage.driver === "s3";
}

function localPathFor(key: string, storage: RuntimeProviderConfig["storage"]): string {
  const root = storage.localPath;
  const target = path.resolve(root, normalizeKey(key));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid storage key");
  return target;
}

function createS3Client(storage: RuntimeProviderConfig["storage"]): S3Client {
  const { accessKeyId, secretAccessKey } = requireS3Config(storage);
  return new S3Client({
    region: storage.region,
    endpoint: storage.endpoint,
    forcePathStyle: storage.forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function publicMediaPath(key: string): string {
  return `/api/media?key=${encodeURIComponent(key)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const { storage } = await getRuntimeProviderConfig();
  if (isS3(storage)) {
    const { bucket } = requireS3Config(storage);
    await createS3Client(storage).send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
  } else {
    const target = localPathFor(key, storage);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  return { key, url: publicMediaPath(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: publicMediaPath(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const { storage } = await getRuntimeProviderConfig();
  if (!isS3(storage)) return pathToFileURL(localPathFor(key, storage)).toString();
  const { bucket } = requireS3Config(storage);
  return getSignedUrl(createS3Client(storage), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 15 });
}

export async function checkStorageHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { storage } = await getRuntimeProviderConfig();
    if (!isS3(storage)) {
      await fs.mkdir(storage.localPath, { recursive: true });
      await fs.access(storage.localPath);
      return { ok: true, detail: `Local storage ready: ${storage.localPath}` };
    }
    const { bucket } = requireS3Config(storage);
    await createS3Client(storage).send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, detail: `S3 bucket reachable: ${bucket}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Storage health check failed" };
  }
}
