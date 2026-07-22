# Git AI Iterative Refinement Design

## Overview

Extend the existing full Git AI analysis dialog with an in-memory, report-oriented refinement session. The UI continues to show one complete Markdown analysis at a time. Each successful refinement appends a linear version, while the AI provider boundary remains a stateless single-prompt stream.

## Boundaries

### `src/components/project/GitTab.vue`

Owns dialog orchestration and renderer-session memory:

- opening, closing, and starting a new analysis
- capturing the initial Git prompt and scope summary
- locking mode and diff controls after version 1
- streaming a first result or refinement draft
- selecting, navigating, restoring, copying, and displaying versions
- follow-up text entry and keyboard submission
- context-generation guards that ignore stale asynchronous results

The component keeps sessions in a module-scoped `Map` keyed by the existing Git repository `contextKey`. This matches the current renderer-memory pattern used for repository choices and commit drafts. It allows a session to survive closing the modal and temporarily switching project-detail tabs without promoting visual state to Pinia or persistent storage.

All remembered AI sessions for the previous project are cleared when a different project Git tab becomes active. Switching repository target clears the current project's remembered AI sessions before entering the new target. Renderer shutdown naturally clears the map.

### `src/lib/gitAiAnalysisSession.ts`

Contains only domain-specific pure data and operations that would otherwise make the large Git component harder to reason about:

- session and version interfaces
- empty session creation
- linear version append and restore operations
- refinement prompt composition

It imports the existing `AiReasoningStreamState` type. These UI-session types do not belong in `src/types.ts` because they never cross a component, store, persistence, or preload boundary.

### Existing AI layers

The following contracts remain unchanged:

- `AiReasoningResult.vue` continues to render one reasoning/content state.
- `useStore.analyzeGitWithAiStream(...)` continues to receive one prompt and emit chunks plus one terminal result.
- `projectBridge.ts` and `public/preload.js` remain unchanged.
- AI commit-message generation remains unchanged.

## Data Model

```ts
interface GitAiAnalysisVersion {
  id: number;
  sourceVersionId: number | null;
  instruction: string;
  result: AiReasoningStreamState;
}

interface GitAiAnalysisSession {
  basePrompt: string;
  scopeSummary: string;
  notice: string;
  modeId: string;
  includeDiffContext: boolean;
  versions: GitAiAnalysisVersion[];
  activeVersionId: number | null;
  nextVersionId: number;
}
```

The first result has `sourceVersionId: null` and an empty instruction. A refinement records the selected source version and the latest user instruction. Restoring an old version appends a copy as a new latest version instead of mutating history or creating a visible branch.

The component keeps transient request state separately from successful versions:

- request state: idle/loading/success/warning/error
- streaming draft: `AiReasoningStreamState`
- error/status message
- trimmed follow-up draft
- repository context generation captured when the request starts

Only a completed result with non-empty final-answer content is appended. Reasoning-only or empty responses are failures and do not create versions.

## Prompt Contract

The initial generation uses the current `buildAiPrompt(...)` result and stores that exact prompt as `basePrompt`.

Each refinement sends one composed prompt containing:

1. the stored original `basePrompt`;
2. the selected version's final answer;
3. the latest trimmed user instruction;
4. an explicit instruction to return one complete, self-contained revised analysis and incorporate answers into the relevant report section.

No earlier instructions, detached answers, or full conversation transcript are included. Reasoning text and raw preservation text are not fed back as the previous result.

## Interaction Flow

### First generation

1. The user selects mode and diff inclusion.
2. Generation captures the current repository context, scope summary, and built prompt.
3. Controls lock while streaming.
4. A non-empty successful final answer is appended as version 1 and the refinement composer appears.

### Refinement

1. The user views any successful version and submits a non-empty instruction.
2. The request uses that displayed version as its source.
3. Until the first draft content appears, the source version remains visible. The result panel then displays the streaming draft with an explicit generating label.
4. Success appends and selects a new latest version. Failure returns display focus to the source version and leaves all versions intact.

### Navigation and restore

- Previous and next controls move through the linear version array.
- Restore appends the displayed old result as a new latest version and selects it.
- Copy always copies only the displayed version's final answer.
- Version navigation and restore are disabled during a generation to avoid changing the captured source mid-request.

### New analysis

`New analysis` is disabled during generation. Activating it clears the current repository session, resets request/draft state, and unlocks mode and diff controls. It does not change the selected commits or current Git snapshot; those are captured when the next first generation starts.

## Layout

Keep the existing teleported dialog and fixed shell dimensions.

- Header: title plus the captured scope summary when a session exists.
- Setup row: mode selector, diff checkbox, and initial `Generate`; after version 1, controls are disabled and the action becomes `New analysis`.
- Result header: compact version count, previous/next icon buttons, restore icon button for an older version, and existing copy action.
- Result body: the only scrolling region, still rendered by `AiReasoningResult`.
- Composer: fixed below the result after version 1, with a compact textarea and send icon button. `Enter` submits; `Shift+Enter` inserts a newline.

Use existing semantic tokens, Lucide icons, disabled styling, tooltip/title conventions, and `aria-busy` on the generating result region. Do not add nested cards, suggestion chips, a transcript pane, or a second result scrollbar.

## Compatibility and Failure Handling

- Provider compatibility is unchanged because refinement remains a single prompt string.
- Existing structured reasoning parsing and copy semantics are unchanged.
- The current repository-generation guard remains authoritative for stale chunks and terminal callbacks after project/repository changes.
- Closing the modal does not cancel an in-flight request; reopening shows its current state. Switching project/repository invalidates callbacks and clears the session.
- Browser preview continues to report that AI is unavailable; the dialog must leave loading state and preserve existing versions on that failure.

## Rollback

The change is isolated from persistence and bridge contracts. Rollback consists of removing the session helper/test and restoring the existing single-result dialog state and template in `GitTab.vue`. No data migration or cleanup is required.
