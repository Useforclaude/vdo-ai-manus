import * as db from "./db";
import { getOpenAiCompatibleUrl } from "./runtimeConfig";
import { checkStorageHealth } from "./storage";
import { getRuntimeProviderConfig } from "./systemConfig";

export type ServiceHealth = {
  id: "mysql" | "storage" | "ai";
  label: string;
  status: "healthy" | "degraded" | "unconfigured";
  detail: string;
  checkedAt: Date;
};

async function checkMysql(): Promise<ServiceHealth> {
  const checkedAt = new Date();
  try {
    await db.pingDatabase();
    return { id: "mysql", label: "MySQL", status: "healthy", detail: "Database query completed successfully", checkedAt };
  } catch (error) {
    return { id: "mysql", label: "MySQL", status: "degraded", detail: error instanceof Error ? error.message : "Database health check failed", checkedAt };
  }
}

async function checkStorage(): Promise<ServiceHealth> {
  const checkedAt = new Date();
  const { storage } = await getRuntimeProviderConfig();
  const result = await checkStorageHealth();
  return {
    id: "storage",
    label: storage.driver === "s3" ? "MinIO / S3" : "Local media storage",
    status: result.ok ? "healthy" : "degraded",
    detail: result.detail,
    checkedAt,
  };
}

async function checkAi(): Promise<ServiceHealth> {
  const checkedAt = new Date();
  const { ai } = await getRuntimeProviderConfig();
  if (!ai.llmBaseUrl) {
    return { id: "ai", label: "AI provider", status: "unconfigured", detail: "Set an OpenAI-compatible LLM endpoint in Settings", checkedAt };
  }
  try {
    const response = await fetch(getOpenAiCompatibleUrl(ai.llmBaseUrl, "models"), {
      headers: ai.llmApiKey ? { Authorization: `Bearer ${ai.llmApiKey}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { id: "ai", label: "AI provider", status: "degraded", detail: `Provider returned HTTP ${response.status}`, checkedAt };
    return { id: "ai", label: "AI provider", status: "healthy", detail: `OpenAI-compatible endpoint reachable (${ai.llmDefaultModel})`, checkedAt };
  } catch (error) {
    return { id: "ai", label: "AI provider", status: "degraded", detail: error instanceof Error ? error.message : "AI provider health check failed", checkedAt };
  }
}

export async function getSystemHealth(): Promise<ServiceHealth[]> {
  const results = await Promise.all([checkMysql(), checkStorage(), checkAi()]);
  // A failed database must never make the live health endpoint fail. In that case
  // the immediate result still communicates the degraded state to the operator.
  try {
    await db.recordSystemHealthChecks(results);
  } catch (error) {
    console.warn("[SystemHealth] Unable to persist health history", error);
  }
  return results;
}

export async function testAiProviderConnection(): Promise<ServiceHealth> {
  const results = await getSystemHealth();
  const result = results.find(item => item.id === "ai");
  if (!result) throw new Error("AI provider health result was not returned");
  return result;
}
