# 自动任务功能实施计划

## Checklist

1. Add automation types in `src/types.ts`.
2. Add normalization and persistence for `Project.automationTasks` in `src/store/useStore.ts`.
3. Extract schedule generation and validation helpers, preferably under `src/lib/automationScheduler.ts`.
4. Add automation store state/actions for task CRUD, daily plan generation, next-run timer, run context, history, and notifications.
5. Extend bridge event handling so automation runs can react to stdout/stderr, stdin, exit, and error events.
6. Implement serial project runner using existing `launchScript`, `sendScriptInput`, and `stopScript` actions.
7. Add input step execution for delay and output-match modes, including match-step timeout handling.
8. Add keyword exit watcher that activates only after all input steps complete and relies on max runtime for timeout fallback.
9. Add `AutomationTab.vue` and wire it into `ProjectDetails.vue` with i18n labels.
10. Add dashboard automation overview button/panel and project-detail jump behavior.
11. Update project storage compatibility validation for missing and present automation fields.
12. Run focused validation, then type-check and storage validation.

## Validation Commands

- `npm run type-check`
- `npm run validate:project-storage`
- If schedule helpers are extracted with standalone tests, run that focused test first.

## Risky Areas

- `src/store/useStore.ts`: large shared store; keep changes grouped and avoid unrelated refactors.
- `public/preload.js`: avoid changing process execution unless notification support cannot be handled from renderer.
- `src/types.ts`: new persisted fields must be optional-safe and normalized.
- `ProjectDetails.vue` and `Dashboard.vue`: UI entry additions should preserve existing tab and toolbar behavior.

## Rollback Points

- Types and normalization can be reverted independently if scheduler work changes shape.
- Schedule helper extraction can be validated before UI wiring.
- UI tab and dashboard overview can be added after store behavior is stable.
- Notification calls should remain isolated so they can be disabled without changing runner behavior.

## Implementation Notes

- Use project id as the concurrency boundary: one active automation run per project.
- Store generated random daily plans with date so today's random plan is inspectable and stable.
- Cap history to 20 entries per task during persistence/normalization.
- Treat missed, skipped, timeout, input-match-timeout, script-exit-error, and user-disabled as distinct history reasons.
- Do not start implementation until the user reviews these planning artifacts and explicitly asks to proceed.
