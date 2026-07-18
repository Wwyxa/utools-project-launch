# Implementation Plan: Git Tree Multi-Branch References

## Preconditions

- User reviews and approves `prd.md`, `design.md`, and this plan.
- Keep task `07-18-improve-git-tree-rendering` in planning until approval; do not start implementation or create a commit yet.
- Re-run `trellis-before-dev` context loading before the first source edit.

## Ordered Work

1. Search the current ref helpers, graph-head predicate, icon imports, and semantic color tokens before changing values or adding a helper.
2. In `GitTab.vue`, add a small typed ref-presentation model that parses decorate refs and returns a display name, class list, optional Lucide icon, and strict `isHead` state.
3. Route graph-node HEAD styling through the strict predicate so `remote/HEAD` does not receive the current-HEAD node treatment; retain the existing lane allocation and SVG path rules.
4. Render the shared presentation in both the compact commit row and tooltip ref lists, using icon-plus-text badges with stable truncation and spacing.
5. Run `npm run type-check` immediately after the first source edit. Repair only the touched Git Tab slice if it fails.
6. Run `npm run build`; then start the Vite development server and inspect the Git panel at normal and narrow host-like widths.
7. Exercise a real repository's current branch, a switched local branch, a historical remote ref including `remote/HEAD`, a non-main local branch, tag(s) if present, filters, load-more, tooltip, checkbox selection, and branch context-menu actions.
8. Run the Trellis quality check with the curated `check.jsonl` context, resolve in-scope findings, and repeat focused validation.

## Validation Commands

```powershell
npm run type-check
npm run build
git diff --check
```

## Review Gates

- No modification to `public/preload.js`, `src/types.ts`, store state, or bridge APIs is expected.
- `remote/HEAD` must classify as remote and never as current HEAD.
- Do not compute or display per-branch ahead/behind counts.
- The current checked-out branch remains the graph's lane-zero anchor after branch switching.
- Both ref rendering locations use one presentation helper; no duplicated type/color decision tree.
- Use semantic design tokens and existing Lucide components; do not introduce hard-coded palette values or a graph dependency.
- Do not let ref badges resize graph lanes, move SVG node coordinates, or break dense-row interaction targets.

## Rollback Point

If badge density or compatibility regresses, revert the `GitTab.vue` presentation/helper and template changes as one unit. The existing raw-ref rendering and graph layout remain independently intact.
