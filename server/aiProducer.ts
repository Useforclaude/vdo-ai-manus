import { listLLMModels } from "./_core/llm";
import { interpretVideoCommand } from "./videoEditing";

export type AiModelOption = {
  id: string;
  provider: "OpenAI" | "Anthropic" | "Google" | "Other";
  label: string;
};

function providerForModel(modelId: string): AiModelOption["provider"] {
  const id = modelId.toLowerCase();
  if (id.includes("claude")) return "Anthropic";
  if (id.includes("gemini")) return "Google";
  if (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return "OpenAI";
  return "Other";
}

export async function listAiProducerModels(): Promise<AiModelOption[]> {
  try {
    const { data } = await listLLMModels();
    return data
      .map(model => ({ id: model.id, provider: providerForModel(model.id), label: model.id }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label));
  } catch (error) {
    console.warn("[AI Producer] Unable to list model catalog", error);
    return [];
  }
}

export async function createAiProducerDraft(prompt: string, model?: string) {
  const plan = await interpretVideoCommand(prompt, model);
  return {
    command: prompt,
    selectedModel: model ?? null,
    summary: plan.summary,
    operations: plan.operations,
    sourceLanguage: plan.sourceLanguage,
  };
}
