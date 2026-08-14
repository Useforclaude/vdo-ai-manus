import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireS3Config, runtimeConfig } from "./runtimeConfig";

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

function isS3(): boolean {
  return runtimeConfig.storage.driver === "s3";
}

function localPathFor(key: string): string {
  const root = runtimeConfig.storage.localPath;
  const target = path.resolve(root, normalizeKey(key));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid storage key");
  return target;
}

function createS3Client(): S3Client {
  const { accessKeyId, secretAccessKey } = requireS3Config();
  return new S3Client({
    region: runtimeConfig.storage.region,
    endpoint: runtimeConfig.storage.endpoint,
    forcePathStyle: runtimeConfig.storage.forcePathStyle,
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
  if (isS3()) {
    const { bucket } = requireS3Config();
    await createS3Client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
  } else {
    const target = localPathFor(key);
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
  if (!isS3()) return pathToFileURL(localPathFor(key)).toString();
  const { bucket } = requireS3Config();
  return getSignedUrl(createS3Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 15 });
}
