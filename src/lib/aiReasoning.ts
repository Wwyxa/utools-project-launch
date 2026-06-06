import type { AiAnalyzeResult, AiStreamChunkPayload } from "../types";

export interface AiReasoningParts {
  content: string;
  reasoning: string;
  rawContent: string;
  hasReasoning: boolean;
}

export interface AiReasoningStreamState {
  content: string;
  reasoning: string;
  rawContent: string;
  textContent: string;
  structuredReasoning: string;
}

const reasoningTagPattern = /<\/?(?:think|thinking|reasoning)\b[^>]*>/i;
const completeReasoningTagPattern = /<(think|thinking|reasoning)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const markdownFencePattern = /^\s*(`{3,}|~{3,})/;

const appendReasoningBlock = (current: string, next: string) => {
  if (!next) return current;
  return current ? `${current}\n\n${next}` : next;
};

const isInsideMarkdownFence = (raw: string, index: number) => {
  const lines = raw.slice(0, index).split("\n");
  let fenceMarker = "";

  for (const line of lines) {
    const match = markdownFencePattern.exec(line);
    if (!match) continue;
    const marker = match[1];
    if (!fenceMarker) {
      fenceMarker = marker;
    } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
      fenceMarker = "";
    }
  }

  return Boolean(fenceMarker);
};

const isInsideInlineCode = (raw: string, index: number) => {
  const lineStart = raw.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const linePrefix = raw.slice(lineStart, index);
  let openBacktickRun = 0;

  for (const match of linePrefix.matchAll(/`+/g)) {
    const runLength = match[0].length;
    if (runLength >= 3) continue;
    if (openBacktickRun === 0) {
      openBacktickRun = runLength;
    } else if (runLength === openBacktickRun) {
      openBacktickRun = 0;
    }
  }

  return openBacktickRun > 0;
};

const isReasoningTagBlockStart = (raw: string, index: number) => {
  if (index <= 0) return true;
  const lineStart = raw.lastIndexOf("\n", index - 1) + 1;
  return raw.slice(lineStart, index).trim().length === 0;
};

const isConservativeReasoningTagMatch = (raw: string, index: number) =>
  isReasoningTagBlockStart(raw, index) && !isInsideMarkdownFence(raw, index) && !isInsideInlineCode(raw, index);

export const createAiReasoningStreamState = (): AiReasoningStreamState => ({
  content: "",
  reasoning: "",
  rawContent: "",
  textContent: "",
  structuredReasoning: "",
});

export const parseInlineReasoningTags = (rawContent: string): AiReasoningParts => {
  const raw = rawContent || "";
  completeReasoningTagPattern.lastIndex = 0;

  let content = "";
  let reasoning = "";
  let cursor = 0;
  let found = false;

  for (const match of raw.matchAll(completeReasoningTagPattern)) {
    const matchStart = match.index || 0;
    if (!isConservativeReasoningTagMatch(raw, matchStart)) {
      return { content: raw, reasoning: "", rawContent: raw, hasReasoning: false };
    }
    found = true;
    content += raw.slice(cursor, matchStart);
    reasoning = appendReasoningBlock(reasoning, match[2] || "");
    cursor = matchStart + match[0].length;
  }

  if (!found) {
    return { content: raw, reasoning: "", rawContent: raw, hasReasoning: false };
  }

  content += raw.slice(cursor);
  if (reasoningTagPattern.test(content)) {
    return { content: raw, reasoning: "", rawContent: raw, hasReasoning: false };
  }

  return {
    content,
    reasoning,
    rawContent: raw,
    hasReasoning: reasoning.length > 0,
  };
};

const buildDisplayState = (textContent: string, structuredReasoning: string, rawContent: string) => {
  const parsedText = parseInlineReasoningTags(textContent);
  const hasInlineReasoning = parsedText.hasReasoning;
  const content = hasInlineReasoning ? parsedText.content : textContent;
  const reasoning = hasInlineReasoning
    ? appendReasoningBlock(structuredReasoning, parsedText.reasoning)
    : structuredReasoning;

  return {
    content,
    reasoning,
    rawContent,
    textContent,
    structuredReasoning,
  } satisfies AiReasoningStreamState;
};

const chunkRawText = (chunk: Exclude<AiStreamChunkPayload, string>) => {
  if (typeof chunk.rawContent === "string") {
    return chunk.rawContent;
  }
  return `${chunk.reasoning || ""}${chunk.content || ""}`;
};

export const aiStreamChunkRawText = (chunk: AiStreamChunkPayload) =>
  typeof chunk === "string" ? chunk : chunkRawText(chunk);

export const appendAiStreamChunk = (
  state: AiReasoningStreamState,
  chunk: AiStreamChunkPayload,
): AiReasoningStreamState => {
  if (typeof chunk === "string") {
    const rawContent = state.rawContent + chunk;
    const textContent = state.textContent + chunk;
    return buildDisplayState(textContent, state.structuredReasoning, rawContent);
  }

  const content = typeof chunk.content === "string" ? chunk.content : "";
  const reasoning = typeof chunk.reasoning === "string" ? chunk.reasoning : "";
  const rawContent = state.rawContent + chunkRawText(chunk);
  const textContent = state.textContent + content;
  const structuredReasoning = state.structuredReasoning + reasoning;

  return buildDisplayState(textContent, structuredReasoning, rawContent);
};

export const aiReasoningStateFromResult = (result: AiAnalyzeResult): AiReasoningStreamState => {
  const content = result.content || "";
  const structuredReasoning = result.reasoning || "";
  const rawContent = result.rawContent || (structuredReasoning ? `${structuredReasoning}${content}` : content);
  const textContent = structuredReasoning ? content : rawContent;

  return buildDisplayState(textContent, structuredReasoning, rawContent);
};

export const hasAiReasoningDisplay = (state: AiReasoningStreamState) =>
  Boolean(state.content.trim() || state.reasoning.trim() || state.rawContent.trim());

export const aiReasoningCopyText = (state: AiReasoningStreamState) => {
  return state.content;
};
