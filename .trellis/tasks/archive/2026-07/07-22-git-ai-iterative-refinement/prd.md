# Git AI 分析多轮修订

## Goal

Allow users to iteratively improve a Git AI analysis when the first generated result is incomplete or unsuitable, while keeping the experience focused on producing one coherent final report instead of becoming a general-purpose chat interface.

## Background

- The full Git AI analysis dialog already lets users choose an analysis mode, include or exclude diff context, stream a Markdown result, and copy the generated content.
- Starting a generation currently replaces the displayed result, so users cannot refine a result safely or return to an earlier version.
- The existing AI request boundary accepts a single prompt string. Iterative refinement can therefore be implemented by composing each request from the original Git context, one selected result, and the latest user instruction; provider-level conversation support is not required.

## Requirements

### R1. Scope

- Iterative refinement applies only to the full Git AI analysis dialog.
- AI commit-message generation keeps its existing one-shot generation and manual editing workflow.

### R2. Initial analysis

- Before the first generation, users can choose the analysis mode and whether diff context is included, as they can today.
- A successful first generation becomes version 1 of the analysis.
- After version 1 exists, the analysis mode and diff-context control are locked for that analysis session.

### R3. Refinement

- After a successful result exists, the dialog provides a text input for a follow-up instruction or question.
- Each non-empty follow-up produces a new complete, self-contained analysis result rather than a detached chat answer.
- A question such as why an item is risky must be incorporated into the relevant part of the complete revised result.
- A refinement request contains only the original Git analysis context, the user-selected source version, and the latest follow-up instruction. It must not accumulate a full conversation transcript.

### R4. Linear versions

- Every successful first generation or refinement is retained as an in-memory version for the current analysis session.
- Users can move to the previous or next version and restore an earlier version.
- Refining or restoring an older version appends a new latest version; the UI does not expose a branching version tree.
- The result area always presents one complete version as the current result and continues to support copying that result.

### R5. New analysis and lifecycle

- A `New analysis` action clears the current versions and unlocks the analysis mode and diff-context controls.
- Closing the dialog or temporarily switching to another project-detail tab does not discard the current analysis session. Returning to the Git tab and reopening the dialog in the same repository context restores its current version and history.
- The in-memory analysis session is cleared when the user starts a new analysis, switches repository context, switches project, or exits the application.
- Analysis sessions and versions are not persisted to local storage or project data.

### R6. Loading and failure safety

- Starting a refinement does not destroy or blank the last successful result.
- While a new version streams, the user receives an explicit generating state and cannot submit a second concurrent generation.
- A failed or empty refinement leaves all successful versions available and presents a retryable inline error.

### R7. Interaction quality

- The follow-up input supports `Enter` to submit and `Shift+Enter` for a new line.
- Empty or whitespace-only follow-up instructions cannot be submitted.
- Version navigation, copy, new-analysis, and submit controls have accessible names and disabled states.
- The layout remains usable within the dialog's existing desktop and constrained viewport dimensions without overlapping the result or controls.

## Out of Scope

- A chat transcript or chat bubbles.
- Independent question-and-answer messages outside the complete analysis result.
- Persistent AI analysis history across application restarts.
- A reusable cross-feature AI conversation framework.
- Provider protocol changes, server-side conversation IDs, or native multi-message request support.
- Prompt suggestion chips or predefined refinement commands.

## Acceptance Criteria

- [ ] AC1: The full Git AI analysis dialog can generate version 1 with the existing mode and diff-context choices, while commit-message generation remains unchanged.
- [ ] AC2: After version 1 succeeds, mode and diff controls are locked and a non-empty follow-up can stream a complete version 2 without clearing version 1.
- [ ] AC3: The refinement request is built from the original analysis context, the selected source result, and the latest instruction only.
- [ ] AC4: Users can navigate all successful versions, copy the displayed version, and restore or refine an older version as a new latest linear version.
- [ ] AC5: Closing and reopening the dialog, including after a temporary project-detail tab switch, preserves the in-memory session in the same repository context; starting a new analysis or changing project/repository context clears it.
- [ ] AC6: A failed or empty generation preserves all previous successful versions and shows an actionable error state.
- [ ] AC7: Keyboard submission, disabled states, accessible labels, scrolling, and constrained-layout behavior work without regressions.
- [ ] AC8: No AI session data is written to persisted project or application storage, and no AI provider request contract is changed.

## Notes

- This is a complex frontend interaction change and requires `design.md` and `implement.md` before activation.
