import { getOpenAiCompatibleUrl } from "../runtimeConfig";
import { getRuntimeProviderConfig } from "../systemConfig";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type InvokeParams = {
  model?: string;
  messages: ChatMessage[];
  [key: string]: unknown;
};
export type InvokeResult = {
  choices?: Array<{ message?: { content?: string | null } }>;
  [key: string]: unknown;
};

function authorizationHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const { ai } = await getRuntimeProviderConfig();
  if (!ai.llmBaseUrl) {
    throw new Error("LLM is not configured. Set CINEFLOW_LLM_BASE_URL to an OpenAI-compatible endpoint.");
  }
  const response = await fetch(getOpenAiCompatibleUrl(ai.llmBaseUrl, "chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorizationHeaders(ai.llmApiKey) },
    body: JSON.stringify({ ...params, model: params.model ?? ai.llmDefaultModel }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`LLM request failed (${response.status}): ${details}`);
  }
  return await response.json() as InvokeResult;
}

export async function listLLMModels(): Promise<{ data: Array<{ id: string }> }> {
  const { ai } = await getRuntimeProviderConfig();
  if (!ai.llmBaseUrl) return { data: [{ id: ai.llmDefaultModel }] };
  try {
    const response = await fetch(getOpenAiCompatibleUrl(ai.llmBaseUrl, "models"), {
      headers: authorizationHeaders(ai.llmApiKey),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const data = (body.data ?? []).flatMap(model => typeof model.id === "string" ? [{ id: model.id }] : []);
    return { data: data.length ? data : [{ id: ai.llmDefaultModel }] };
  } catch {
    return { data: [{ id: ai.llmDefaultModel }] };
  }
}
