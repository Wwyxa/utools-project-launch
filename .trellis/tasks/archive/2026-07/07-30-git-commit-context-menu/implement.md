# Git Commit Context Menu Implementation Plan

## Checklist

1. **Structure commit decorations**
   - Add shared structured commit-ref types while retaining the legacy string fallback.
   - Build local/remote/tag/HEAD decorations in preload with one ref map, including peeled annotated tags and comma-containing names.
   - Update GitTab ref presentation and branch-menu candidates to consume structured kinds.
   - Extend `validate-git-commits.mjs` for structured classification and comma refs.
   - Focused validation: `npm run validate:git-commits` and `npm run type-check`.

2. **Add Git ref write contracts**
   - Add the action blocker union and bridge methods/options in shared types.
   - Implement browser fallback methods.
   - Implement preload validation and commands for branch create, optional atomic checkout, lightweight/annotated tag, rename, safe/force delete, remote tracking checkout, and explicit detached checkout.
   - Expose all methods through `window.projectBridge`.
   - Focused validation: `node --check public/preload.js` and `npm run validate:git-commits`.

3. **Wire authorized store actions**
   - Add store proxies using the resolved repository target and `{ refresh: "full", refs: true }`.
   - Replace localized dirty-message matching with structured blocker handling.
   - Extend workspace tests for exact target routing, stale-target rejection, ref-version invalidation, and refresh behavior without duplicating identical race cases for every method.
   - Focused validation: `npx vitest run src/lib/projectBridge.workspace.test.ts`.

4. **Build the compact main/submenu interaction**
   - Replace the current commit menu branch list with grouped create actions, separator, no-branch detached action, and structured branch rows.
   - Add local and remote submenus, actual-size viewport clamping, scroll/resize cleanup, outside-click handling, hierarchical Escape, roving keyboard focus, and focus restoration.
   - Make branch badges copy the full name with tooltip and success/error feedback; do not add a copy icon/button.
   - Keep all rows single-line and preserve the existing compact visual direction.
   - Focused validation: `npm run type-check`, then browser geometry/keyboard smoke with injected local, remote, multiple, and long refs.

5. **Add ref dialogs and risk workflows**
   - Add one mode-driven form dialog for create branch, rename branch, and create tag.
   - Implement the default-off create-and-switch checkbox and default-off annotated-tag checkbox with conditional required message.
   - Reuse `ProjectActionDialog` for initial safe-delete confirmation and second force-delete confirmation.
   - Route local/remote/detached operations through typed blocker flows and existing Git action feedback.
   - Focused validation: `npm run type-check`, browser form/Escape/focus/busy smoke, and real Git validation.

6. **Run full review and synchronize guidance**
   - Run the Trellis check agent against PRD/design/spec manifests.
   - Fix only task-related findings and rerun focused checks.
   - Update the frontend spec if structured refs or nested Git menu behavior establishes a reusable project contract.

## Full Validation

- `node --check public/preload.js`
- `npm run validate:git-commits`
- `npx vitest run src/lib/projectBridge.workspace.test.ts`
- `npm run type-check`
- `npm run build`
- Browser desktop and compact viewport smoke:
  - no branch, one local branch, multiple local/remote branches, long and comma-containing names
  - mouse and ContextMenu/Shift+F10 entry
  - ArrowUp/Down/Home/End and right/left submenu navigation
  - Escape hierarchy, outside click, scroll/resize cleanup, and focus restoration
  - branch badge copy tooltip and success/error feedback
  - create/rename/tag forms, conditional controls, busy state, inline errors, and ref refresh
  - current branch restrictions, dirty checkout confirmation, safe delete, and second force-delete confirmation

## Review Gates

- Do not start implementation until the user approves the latest planning summary.
- After shared type/preload edits, do not proceed to UI work until real Git validation passes.
- After the first menu edit, validate rendered geometry and keyboard focus before adding dialogs.
- Before completion, verify every PRD acceptance criterion and run the exact `trellis-check` agent.

## Risky Files And Rollback Points

- `public/preload.js`: keep each Git command behind existing argv-based helpers; revert the action slice independently if real-repository validation fails.
- `src/types.ts` plus bridge/store: signatures must move together; browser fallback prevents partial runtime exposure.
- `src/components/project/GitTab.vue`: keep menu, submenu, and dialog state local; avoid unrelated refactors in this large component.
- Structured refs are additive and can remain if action/UI work is rolled back because legacy `refs` stays available.
