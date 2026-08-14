import { getOpenAiCompatibleUrl, runtimeConfig } from "../runtimeConfig";

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
  if (!runtimeConfig.llm.baseUrl) {
    throw new Error("LLM is not configured. Set CINEFLOW_LLM_BASE_URL to an OpenAI-compatible endpoint.");
  }
  const response = await fetch(getOpenAiCompatibleUrl(runtimeConfig.llm.baseUrl, "chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorizationHeaders(runtimeConfig.llm.apiKey) },
    body: JSON.stringify({ ...params, model: params.model ?? runtimeConfig.llm.defaultModel }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`LLM request failed (${response.status}): ${details}`);
  }
  return await response.json() as InvokeResult;
}

export async function listLLMModels(): Promise<{ data: Array<{ id: string }> }> {
  if (!runtimeConfig.llm.baseUrl) return { data: [{ id: runtimeConfig.llm.defaultModel }] };
  try {
    const response = await fetch(getOpenAiCompatibleUrl(runtimeConfig.llm.baseUrl, "models"), {
      headers: authorizationHeaders(runtimeConfig.llm.apiKey),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const data = (body.data ?? []).flatMap(model => typeof model.id === "string" ? [{ id: model.id }] : []);
    return { data: data.length ? data : [{ id: runtimeConfig.llm.defaultModel }] };
  } catch {
    return { data: [{ id: runtimeConfig.llm.defaultModel }] };
  }
}
