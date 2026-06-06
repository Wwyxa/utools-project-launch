import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = path.join(repoRoot, "src", "lib", "aiReasoning.ts");
const source = await readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});

const tempDir = await mkdtemp(path.join(tmpdir(), "ai-reasoning-"));
const modulePath = path.join(tempDir, "aiReasoning.mjs");

try {
  await writeFile(modulePath, compiled.outputText, "utf8");
  const {
    aiReasoningCopyText,
    aiReasoningStateFromResult,
    appendAiStreamChunk,
    createAiReasoningStreamState,
    parseInlineReasoningTags,
  } = await import(pathToFileURL(modulePath).href);

  assert.deepEqual(parseInlineReasoningTags("<think>plan</think>final"), {
    content: "final",
    reasoning: "plan",
    rawContent: "<think>plan</think>final",
    hasReasoning: true,
  });

  assert.deepEqual(parseInlineReasoningTags("<thinking>draft</thinking>answer"), {
    content: "answer",
    reasoning: "draft",
    rawContent: "<thinking>draft</thinking>answer",
    hasReasoning: true,
  });

  assert.deepEqual(parseInlineReasoningTags("<think>unfinished"), {
    content: "<think>unfinished",
    reasoning: "",
    rawContent: "<think>unfinished",
    hasReasoning: false,
  });

  assert.deepEqual(parseInlineReasoningTags("Use <think>literal</think> as an example"), {
    content: "Use <think>literal</think> as an example",
    reasoning: "",
    rawContent: "Use <think>literal</think> as an example",
    hasReasoning: false,
  });

  assert.deepEqual(parseInlineReasoningTags("```xml\n<thinking>literal</thinking>\n```"), {
    content: "```xml\n<thinking>literal</thinking>\n```",
    reasoning: "",
    rawContent: "```xml\n<thinking>literal</thinking>\n```",
    hasReasoning: false,
  });

  assert.deepEqual(parseInlineReasoningTags("Use `<reasoning>literal</reasoning>` in docs"), {
    content: "Use `<reasoning>literal</reasoning>` in docs",
    reasoning: "",
    rawContent: "Use `<reasoning>literal</reasoning>` in docs",
    hasReasoning: false,
  });

  let state = createAiReasoningStreamState();
  state = appendAiStreamChunk(state, { reasoning: "structured ", content: "final", rawContent: "structured final" });
  assert.equal(state.reasoning, "structured ");
  assert.equal(state.content, "final");
  assert.equal(aiReasoningCopyText(state), "final");

  const reasoningOnlyState = appendAiStreamChunk(createAiReasoningStreamState(), {
    reasoning: "thinking",
    rawContent: "thinking",
  });
  assert.equal(reasoningOnlyState.reasoning, "thinking");
  assert.equal(reasoningOnlyState.content, "");
  assert.equal(aiReasoningCopyText(reasoningOnlyState), "");

  const finalState = aiReasoningStateFromResult({
    ok: true,
    content: "done",
    reasoning: "why",
    rawContent: "why done",
  });
  assert.equal(finalState.content, "done");
  assert.equal(finalState.reasoning, "why");
  assert.equal(aiReasoningCopyText(finalState), "done");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
