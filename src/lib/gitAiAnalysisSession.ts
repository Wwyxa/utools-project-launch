import { aiReasoningCopyText, type AiReasoningStreamState } from "./aiReasoning";

export interface GitAiAnalysisVersion {
  id: number;
  sourceVersionId: number | null;
  instruction: string;
  result: AiReasoningStreamState;
}

export interface GitAiAnalysisSession {
  basePrompt: string;
  scopeSummary: string;
  notice: string;
  modeId: string;
  includeDiffContext: boolean;
  versions: GitAiAnalysisVersion[];
  activeVersionId: number | null;
  nextVersionId: number;
}

export type GitAiAnalysisSessionInput = Pick<
  GitAiAnalysisSession,
  "basePrompt" | "scopeSummary" | "notice" | "modeId" | "includeDiffContext"
>;

export const createGitAiAnalysisSession = (input: GitAiAnalysisSessionInput): GitAiAnalysisSession => ({
  ...input,
  versions: [],
  activeVersionId: null,
  nextVersionId: 1,
});

export const resolveGitAiAnalysisVersion = (session: GitAiAnalysisSession, versionId = session.activeVersionId) =>
  session.versions.find((version) => version.id === versionId) ?? null;

export const appendGitAiAnalysisVersion = (
  session: GitAiAnalysisSession,
  result: AiReasoningStreamState,
  sourceVersionId: number | null = null,
  instruction = "",
): GitAiAnalysisSession => {
  const version: GitAiAnalysisVersion = {
    id: session.nextVersionId,
    sourceVersionId,
    instruction: sourceVersionId === null ? "" : instruction.trim(),
    result: { ...result },
  };

  return {
    ...session,
    versions: [...session.versions, version],
    activeVersionId: version.id,
    nextVersionId: version.id + 1,
  };
};

export const restoreGitAiAnalysisVersion = (session: GitAiAnalysisSession, versionId: number): GitAiAnalysisSession => {
  const version = resolveGitAiAnalysisVersion(session, versionId);
  return version ? appendGitAiAnalysisVersion(session, version.result, version.id) : session;
};

export const composeGitAiRefinementPrompt = (
  session: GitAiAnalysisSession,
  versionId: number,
  instruction: string,
): string | null => {
  const version = resolveGitAiAnalysisVersion(session, versionId);
  const trimmedInstruction = instruction.trim();
  if (!version || !trimmedInstruction) return null;

  return [
    session.basePrompt,
    "Selected analysis result:",
    aiReasoningCopyText(version.result),
    "Latest refinement instruction:",
    trimmedInstruction,
    "Return one complete, self-contained revised analysis. Incorporate the latest instruction into the relevant report section. Do not return a detached answer or conversation transcript.",
  ].join("\n\n");
};
