import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listLLMModels: vi.fn(),
  interpretVideoCommand: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ listLLMModels: mocks.listLLMModels }));
vi.mock("./videoEditing", () => ({ interpretVideoCommand: mocks.interpretVideoCommand }));

import { createAiProducerDraft, listAiProducerModels } from "./aiProducer";

describe("AI producer", () => {
  beforeEach(() => vi.resetAllMocks());

  it("normalizes the available model catalog without returning credentials", async () => {
    mocks.listLLMModels.mockResolvedValue({ data: [
      { id: "openai/gpt-4.1-mini" },
      { id: "anthropic/claude-sonnet-4" },
      { id: "gemini-2.5-flash" },
    ] });

    await expect(listAiProducerModels()).resolves.toEqual([
      { id: "anthropic/claude-sonnet-4", provider: "Anthropic", label: "anthropic/claude-sonnet-4" },
      { id: "gemini-2.5-flash", provider: "Google", label: "gemini-2.5-flash" },
      { id: "openai/gpt-4.1-mini", provider: "OpenAI", label: "openai/gpt-4.1-mini" },
    ]);
  });

  it("uses the selected model only to draft an edit plan, not to start rendering", async () => {
    mocks.interpretVideoCommand.mockResolvedValue({
      sourceLanguage: "th",
      summary: "ตัดเสียงเงียบและสร้างซับ",
      operations: [{ type: "remove_silence" }, { type: "generate_subtitles" }],
    });

    const draft = await createAiProducerDraft("ตัดเสียงเงียบและทำซับ", "anthropic/claude-sonnet-4");

    expect(mocks.interpretVideoCommand).toHaveBeenCalledWith("ตัดเสียงเงียบและทำซับ", "anthropic/claude-sonnet-4");
    expect(draft).toMatchObject({ selectedModel: "anthropic/claude-sonnet-4", summary: "ตัดเสียงเงียบและสร้างซับ" });
    expect(draft).not.toHaveProperty("jobId");
  });
});
