# Implementation Plan: External Icon Packs

## Ordered Checklist

1. Record the no-special-exclusion licensing decision in the PRD and pack notices; preserve the complete current icon set while keeping the source-code/icon-asset/branded-icon distinction explicit.
2. Add the project-owned `icon-packs/vscode-icons-derived/` source directory, extracted assets, source manifest, complete upstream notices, and generated-output ignore rules.
3. Implement `scripts/build-icon-pack.mjs` and `scripts/validate-icon-pack.mjs` using Node built-ins and the existing reference package as build-time input; emit the compressed release package and `checksums.txt` without changing `dist/`.
4. Add the shared TypeScript icon-pack types, preference field, pure resolver, and `FileIcon.vue` fallback renderer.
5. Replace only file/directory icon sites in the project tree, Git working-tree list, and Git commit file list; in Git file rows render an optional themed icon first and move the existing status code after file name/path and change counts, with no icon placeholder when the pack is inactive.
6. Extend the preload and typed bridge with bounded GitHub release discovery, decompression, manifest validation, checksum verification, atomic install/remove, status reporting, and browser unavailable fallbacks.
7. Add Store-owned global icon-pack loading and actions, and extend normalized UI preference persistence with `iconPackId: "builtin"` as the default.
8. Add the settings controls and Chinese/English copy for install, update, remove, activate, fallback, and failure states. Keep all network operations behind explicit buttons.
9. Add `.github/workflows/icon-pack-release.yml`, root npm scripts, release tag/asset validation, and README usage/attribution/licensing documentation.
10. Add focused tests for resolver, preference/bridge behavior, pack validation, package generation, and installation rollback.

## Validation Commands

- `npx vitest run tests/fileIconTheme.test.ts tests/projectBridge.iconPack.test.ts`
- `node scripts/validate-icon-pack.mjs`
- `npm run lint`
- `npm run build`
- `node --check public/preload.js`
- `npm run validate:project-storage`
- `npm run validate:git-workspace`
- `git diff --check`

For release validation, run the icon-pack build command from a clean checkout and assert that only the intended `icon-packs/vscode-icons-derived/icon-pack-release/` assets are generated, the checksum verifies, and `dist/` contains no `icon-packs/` files.

## Risky Files And Rollback Points

- `src/types.ts`, `src/lib/projectBridge.ts`, `src/store/useStore.ts`: shared contracts and startup state. Roll back the feature by retaining the default `builtin` selection and browser unavailable methods.
- `public/preload/icon-packs.js`, `public/preload.js`, `public/preload/preferences.js`: disk/network trust boundary. Keep all writes under the application-data icon-pack directory and preserve the old pack until the new candidate is fully verified.
- `src/components/project/FileTreeNode.vue`, `GitChangesPane.vue`, and `GitCommitHistory.vue`: UI integration. The project file tree retains a Lucide fallback; Git file rows intentionally use the `omit` policy when the external pack is inactive, so they must keep their text, counts, and trailing status visible without an empty icon slot.
- Git file rows must omit the icon node when the pack is inactive; the project file tree may retain its Lucide fallback. This distinction is intentional and must be covered by the layout tests.
- `scripts/build-icon-pack.mjs`, `icon-packs/`, and the release workflow: generated assets and licensing. A release must fail closed on missing upstream notices or invalid resource references while preserving the complete current icon set.
- `README.md` and `src/lib/i18n.ts`: user-facing documentation/copy. Do not describe the pack as MIT-only; distinguish source-code and icon-asset licenses.

## Review Gates Before Activation

- The PRD has no unresolved product decision and records the approved treatment of ambiguous branded assets.
- `design.md` and this plan agree that selection is global, manual, optional, and external to the main plugin bundle.
- `task.py validate 09-02-external-icon-pack` passes; if sub-agent mode is used, `implement.jsonl` and `check.jsonl` contain real spec/research entries. Inline mode may leave them empty.
- The generated pack has a stable ID/version, complete notices, no executable content, and no references to `references/` at runtime.
- The clean plugin build succeeds with no icon-pack assets under `dist/`.