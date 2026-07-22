# Git AI Iterative Refinement Implementation Plan

## Scope

Implement the approved report-oriented multi-round flow only in the full Git AI analysis dialog. Keep commit-message generation, Pinia AI actions, bridge contracts, preload provider calls, and persistence unchanged.

## Implementation Checklist

- [ ] Add `src/lib/gitAiAnalysisSession.ts` with typed session/version records, linear append/restore helpers, and stateless refinement prompt composition.
- [ ] Add `src/lib/gitAiAnalysisSession.test.ts` covering first version creation, refinement from the selected version, restore-as-latest behavior, monotonic version ids, trimming/validation, and prompt exclusion of earlier transcript turns.
- [ ] Replace the Git dialog's single-result reset-on-open behavior with a repository-context session loaded from renderer memory.
- [ ] Capture and retain the exact first-generation prompt, scope summary, truncation notice, selected mode, and diff setting when version 1 starts.
- [ ] Refactor first-generation streaming so only a successful result with non-empty final content is committed as version 1.
- [ ] Add refinement streaming from the displayed source version and latest non-empty instruction, preserving all successful versions on empty or failed output.
- [ ] Add linear previous/next navigation, restore-as-latest, displayed-version copy, locked setup controls, and a `New analysis` reset action.
- [ ] Add the follow-up textarea with `Enter` submit, `Shift+Enter` newline, accessible send control, disabled/busy states, and responsive fixed-footer layout.
- [ ] Preserve an active session across modal close and Git detail-tab remount; clear sessions on new analysis and project/repository changes.
- [ ] Confirm commit-message AI code and provider/store/bridge files have no behavioral changes.

## Focused Validation Sequence

1. After adding the pure helper and test:

   ```bash
   npx vitest run src/lib/gitAiAnalysisSession.test.ts
   ```

2. After integrating session state and prompt flow into `GitTab.vue`:

   ```bash
   npx vitest run src/lib/gitAiAnalysisSession.test.ts
   npm run type-check
   ```

3. After completing the template and interaction states:

   ```bash
   npm run validate:ai-reasoning
   npm run build
   ```

4. Final full-scope frontend check:

   ```bash
   npm run lint
   npx vitest run src/lib/gitAiAnalysisSession.test.ts
   npm run validate:ai-reasoning
   npm run build
   ```

## Manual Verification

- Open Git AI analysis at normal and compact host-like window sizes; verify only the result body scrolls and no controls overlap.
- Generate version 1 with and without diff context; verify the chosen controls lock and the captured scope summary remains stable.
- Submit refinements with Enter and insert a newline with Shift+Enter; verify whitespace-only input is rejected.
- While version 2 streams, verify version 1 is not destroyed; force a provider/config failure and verify version 1 remains selectable and copyable.
- Navigate versions, restore an old version, and refine an old version; verify each action appends a new latest linear version without deleting later versions.
- Close and reopen the modal, then switch away from and back to the Git detail tab; verify the renderer-memory session returns.
- Switch repository target and project; verify the previous analysis session is cleared and stale chunks cannot populate the new context.
- Run the existing AI commit-message action and verify it still writes only the generated final answer into the commit textarea.
- Verify icon-only actions have accessible labels, result loading uses `aria-busy`, and Escape still closes nested controls before the dialog.

## Risks and Rollback Points

- `GitTab.vue` is large and owns several request-generation guards. Keep the existing repository generation checks on every AI chunk and terminal callback; stop and correct this before template work if stale responses can cross contexts.
- Renderer-memory objects must remain repository-context scoped. If tab remount restoration causes cross-project leakage, disable remount restoration temporarily and retain modal-close restoration while correcting the key/cleanup path.
- Do not expand the bridge to accept `messages`. If prompt composition cannot satisfy a provider during manual verification, record that provider-specific evidence before changing the approved architecture.
- Do not alter `AiReasoningResult.vue` unless a reproducible rendering defect is found; the existing component already meets reasoning separation and copy requirements.

## Review Gates

- [ ] PRD requirements R1-R7 map to implementation and manual checks.
- [ ] No task scope has leaked into commit-message generation, persistence, Pinia global state, or preload/provider code.
- [ ] The focused helper test, type check, AI reasoning validation, and production build all pass.
- [ ] Compact-layout, keyboard, modal lifecycle, stale-response, and failure-preservation checks pass manually.
