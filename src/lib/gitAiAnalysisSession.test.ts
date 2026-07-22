import { describe, expect, it } from "vitest";
import type { AiReasoningStreamState } from "./aiReasoning";
import {
  appendGitAiAnalysisVersion,
  composeGitAiRefinementPrompt,
  createGitAiAnalysisSession,
  resolveGitAiAnalysisVersion,
  restoreGitAiAnalysisVersion,
} from "./gitAiAnalysisSession";

const createSession = () =>
  createGitAiAnalysisSession({
    basePrompt: "Original Git analysis context",
    scopeSummary: "2 selected commits",
    notice: "",
    modeId: "analysis",
    includeDiffContext: true,
  });

const resultFor = (content: string, reasoning = "", rawContent = content): AiReasoningStreamState => ({
  content,
  reasoning,
  rawContent,
  textContent: content,
  structuredReasoning: reasoning,
});

describe("Git AI analysis session", () => {
  it("appends the first successful result as version one", () => {
    const result = resultFor("Initial report");
    const session = appendGitAiAnalysisVersion(createSession(), result);

    expect(session).toMatchObject({ activeVersionId: 1, nextVersionId: 2 });
    expect(session.versions).toEqual([
      expect.objectContaining({ id: 1, sourceVersionId: null, instruction: "", result }),
    ]);
  });

  it("records a refinement from the selected source version", () => {
    const first = appendGitAiAnalysisVersion(createSession(), resultFor("Initial report"));
    const refined = appendGitAiAnalysisVersion(first, resultFor("Risk-focused report"), 1, "  explain risks  ");

    expect(resolveGitAiAnalysisVersion(refined)).toMatchObject({
      id: 2,
      sourceVersionId: 1,
      instruction: "explain risks",
      result: expect.objectContaining({ content: "Risk-focused report" }),
    });
    expect(resolveGitAiAnalysisVersion(refined, 1)?.result.content).toBe("Initial report");
  });

  it("restores an older version by appending it as the new latest version", () => {
    const first = appendGitAiAnalysisVersion(createSession(), resultFor("Initial report"));
    const refined = appendGitAiAnalysisVersion(first, resultFor("Refined report"), 1, "add risks");
    const restored = restoreGitAiAnalysisVersion(refined, 1);

    expect(restored.versions.slice(0, 2)).toEqual(refined.versions);
    expect(restored.versions[2]).toMatchObject({
      id: 3,
      sourceVersionId: 1,
      instruction: "",
      result: expect.objectContaining({ content: "Initial report" }),
    });
    expect(restored.activeVersionId).toBe(3);
  });

  it("keeps version ids monotonic after restoring and refining", () => {
    const first = appendGitAiAnalysisVersion(createSession(), resultFor("Version one"));
    const second = appendGitAiAnalysisVersion(first, resultFor("Version two"), 1, "refine one");
    const restored = restoreGitAiAnalysisVersion(second, 1);
    const fourth = appendGitAiAnalysisVersion(restored, resultFor("Version four"), 2, "refine two");

    expect(fourth.versions.map((version) => version.id)).toEqual([1, 2, 3, 4]);
    expect(fourth.nextVersionId).toBe(5);
  });

  it("trims valid instructions, rejects blank ones, and excludes prior transcript data from prompts", () => {
    const first = appendGitAiAnalysisVersion(
      createSession(),
      resultFor("First visible report", "FIRST_REASONING_SHOULD_NOT_APPEAR", "FIRST_RAW_SHOULD_NOT_APPEAR"),
    );
    const selected = appendGitAiAnalysisVersion(
      first,
      resultFor("Selected final report", "SELECTED_REASONING_SHOULD_NOT_APPEAR", "SELECTED_RAW_SHOULD_NOT_APPEAR"),
      1,
      "PRIOR_INSTRUCTION_SHOULD_NOT_APPEAR",
    );

    expect(composeGitAiRefinementPrompt(selected, 2, " \n ")).toBeNull();

    const prompt = composeGitAiRefinementPrompt(selected, 2, "  LATEST_INSTRUCTION  ");
    expect(prompt).toContain("Original Git analysis context");
    expect(prompt).toContain("Selected final report");
    expect(prompt).toContain("LATEST_INSTRUCTION");
    expect(prompt).toContain("Return one complete, self-contained revised analysis.");
    expect(prompt).not.toContain("  LATEST_INSTRUCTION  ");
    expect(prompt).not.toContain("First visible report");
    expect(prompt).not.toContain("PRIOR_INSTRUCTION_SHOULD_NOT_APPEAR");
    expect(prompt).not.toContain("FIRST_REASONING_SHOULD_NOT_APPEAR");
    expect(prompt).not.toContain("FIRST_RAW_SHOULD_NOT_APPEAR");
    expect(prompt).not.toContain("SELECTED_REASONING_SHOULD_NOT_APPEAR");
    expect(prompt).not.toContain("SELECTED_RAW_SHOULD_NOT_APPEAR");
  });
});
