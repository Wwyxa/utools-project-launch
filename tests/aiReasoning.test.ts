import { describe, expect, it } from "vitest";
import {
  aiReasoningCopyText,
  aiReasoningStateFromResult,
  appendAiStreamChunk,
  createAiReasoningStreamState,
  parseInlineReasoningTags,
} from "../src/lib/aiReasoning";

describe("AI reasoning", () => {
  it.each([
    ["<think>plan</think>final", "plan", "final"],
    ["<thinking>draft</thinking>answer", "draft", "answer"],
  ])("extracts a complete reasoning block from %s", (rawContent, reasoning, content) => {
    expect(parseInlineReasoningTags(rawContent)).toEqual({ content, reasoning, rawContent, hasReasoning: true });
  });

  it.each([
    "<think>unfinished",
    "Use <think>literal</think> as an example",
    "```xml\n<thinking>literal</thinking>\n```",
    "Use `<reasoning>literal</reasoning>` in docs",
  ])("preserves incomplete or literal reasoning markup: %s", (rawContent) => {
    expect(parseInlineReasoningTags(rawContent)).toEqual({
      content: rawContent,
      reasoning: "",
      rawContent,
      hasReasoning: false,
    });
  });

  it.each([
    { reasoning: "structured ", content: "final", rawContent: "structured final" },
    { reasoning: "thinking", rawContent: "thinking" },
  ])("copies only answer content from a structured chunk: $rawContent", (chunk) => {
    const state = appendAiStreamChunk(createAiReasoningStreamState(), chunk);
    expect(state).toMatchObject({ ...chunk, content: chunk.content ?? "" });
    expect(aiReasoningCopyText(state)).toBe(chunk.content ?? "");
  });

  it("keeps reasoning separate from the completed answer", () => {
    const state = aiReasoningStateFromResult({ ok: true, content: "done", reasoning: "why", rawContent: "why done" });
    expect(state).toMatchObject({ content: "done", reasoning: "why" });
    expect(aiReasoningCopyText(state)).toBe("done");
  });
});
