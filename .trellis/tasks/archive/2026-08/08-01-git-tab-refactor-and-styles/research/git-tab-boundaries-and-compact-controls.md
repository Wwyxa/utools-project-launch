# Research: GitTab boundaries and compact Git controls

- **Query**: 研究 `GitTab.vue` 的职责边界、最少拆分、状态归属，以及参考 VS Code SCM 的紧凑控件验收标准。
- **Scope**: internal
- **Date**: 2026-08-01

## Findings

### Files Found

| File Path                                                                          | Description                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/project/GitTab.vue:186`                                            | 当前唯一 Git 页入口；对外只有 `project`、`open-file` 和少量 `defineExpose`。                  |
| `src/components/project/GitTab.vue:876`                                            | 仓库切换时统一清理 diff、历史、tooltip、AI 和写操作反馈状态。                                 |
| `src/components/project/GitTab.vue:2614`                                           | tooltip 文件摘要/头像异步加载、缓存和 generation 防陈旧响应。                                 |
| `src/components/project/GitTab.vue:3350`                                           | ref 分类、去重和紧凑 remote 徽标规则。                                                        |
| `src/components/project/GitTab.vue:3405`                                           | 提交文件树构建、排序、compact folder 和可见项扁平化。                                         |
| `src/components/project/GitTab.vue:3528`                                           | Git 图泳道、边、节点、展开高度和画布尺寸计算。                                                |
| `src/store/useStore.ts:1097`                                                       | Pinia 已集中 Git snapshot、workspace、refresh/loading 和 write-in-progress 状态。             |
| `src/store/useStore.ts:2293`                                                       | Store 已按 `projectId + repositoryTarget` 解析 context 和唯一 snapshot。                      |
| `src/store/useStore.ts:2657`                                                       | Store 写操作统一授权、mutation version、刷新和并发计数。                                      |
| `src/composables/useResizableSplit.ts:19`                                          | 真正跨多个 tab 复用的完整交互 composable；包含会话记忆、测量和清理。                          |
| `src/components/project/GitDiffViewer.vue:8`                                       | 现有窄组件契约范例：少量 props，只发出 `update:scrollTop`。                                   |
| `src/components/project/ExternalApplicationLaunchButton.vue:9`                     | 完整菜单生命周期组件范例：只发出 `launch(applicationId)`。                                    |
| `src/index.css:414`                                                                | 共享 `ui-field`、compact field、focus 和深色 placeholder 规则。                               |
| `references/vscode/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts:412` | VS Code SCM history 统一 22px tree row，并由一个 renderer 组合 graph、label、badge、actions。 |
| `references/vscode/src/vs/workbench/contrib/scm/browser/media/scm.css:132`         | VS Code SCM 紧凑行、hover/focus actions、输入和 badge 的本地样式参考。                        |

### 1. Genuine Change Boundaries

| Responsibility                            | Boundary                      | Evidence / Decision                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository context and page orchestration | Keep in `GitTab.vue`          | Active repository controls every section, split review, top status, remote actions and reset generation (`GitTab.vue:198`, `GitTab.vue:876`).                                                                                 |
| Working-tree changes + commit composer    | Component boundary            | Staged/unstaged groups, commit textarea, file writes and input sizing form one UI workflow (`GitTab.vue:297`, `GitTab.vue:1171`, `GitTab.vue:4329`). It only needs to notify the parent which diff/open-file target changed.  |
| Commit history surface                    | Component boundary            | Filters, selection, pagination observer, expanded files, graph, tooltip, refs, context menus and ref dialogs share one scroll/lifecycle boundary (`GitTab.vue:711`, `GitTab.vue:2539`, `GitTab.vue:2872`, `GitTab.vue:4563`). |
| Ref presentation                          | Pure module boundary          | Structured/legacy ref classification and dense-row compaction change independently from graph geometry (`GitTab.vue:3250`, `GitTab.vue:3350`).                                                                                |
| Graph layout                              | Pure module boundary          | Deterministic lane/path/height calculation has explicit numeric inputs and no DOM requirement (`GitTab.vue:3379`, `GitTab.vue:3528`).                                                                                         |
| Commit file tree                          | Pure module boundary          | Path normalization, compact folders, sort order and visible-item flattening are deterministic and separately testable (`GitTab.vue:3385`, `GitTab.vue:3405`).                                                                 |
| AI analysis dialog                        | Component boundary            | It owns stream/session/version/composer/dialog lifecycle and consumes either worktree or selected-history scope (`GitTab.vue:217`, `GitTab.vue:2241`, `GitTab.vue:2409`).                                                     |
| Top repository/remote strip               | Keep in `GitTab.vue`          | This is the shared repository context and cross-section write coordinator, not an isolated child view (`GitTab.vue:454`, `GitTab.vue:907`).                                                                                   |
| Right diff review                         | Keep composed in `GitTab.vue` | Both changes and history select it; `GitDiffViewer` is already the isolated renderer (`GitTab.vue:304`, `GitTab.vue:2846`, `GitTab.vue:4674`).                                                                                |

### 2. Minimum Stable Split And Contracts

The minimum end state is three domain components plus three pure modules. It preserves the existing public `GitTab` API used by `ProjectDetails.vue:712`.

| New owner                                    | Narrow contract                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/project/GitChangesPane.vue`      | Props: `projectId`, `repositoryTarget`, `open`, `disabled`, `commitMessage`, current worktree selection. Events: `update:open`, `update:commitMessage`, `select-file(path, scope)`, `open-file(path)`, `feedback(state, message)`. It reads the canonical snapshot and invokes file/commit actions through Pinia; do not pass `files`, store actions or a snapshot copy. |
| `components/project/GitCommitHistory.vue`    | Props: `projectId`, `repositoryTarget`, `open`, `disabled`, `selectedCommitHashes`. Events: `update:open`, `update:selectedCommitHashes`, `review-file(commitHash, path, commitMessage)`, `request-ai`, `feedback(state, message)`. It owns filters, graph, expanded files, tooltip, context/ref menus and load-more lifecycle.                                          |
| `components/project/GitAiAnalysisDialog.vue` | Props: `open`, `projectId`, `repositoryTarget`, `selectedCommitHashes`. Event: `close`. It derives context/snapshot/AI preferences from Pinia and owns renderer-session AI results. Move the exported project-session cleanup with this owner; `GitTab` may re-export it temporarily to avoid changing callers in the same step.                                         |
| `lib/gitCommitRefs.ts`                       | Pure semantic outputs only: `presentGitCommitRefs`, `compactGitCommitRefs`, `commitBranchRefs`, `commitTagRefs`. Input includes structured refs plus known local/remote names. Return kinds/labels/flags, never Vue `Component`, icons or CSS class strings.                                                                                                             |
| `lib/gitCommitGraph.ts`                      | Pure `layoutGitCommitGraph(commits, { currentBranch, headHashes, expandedHeights, rowHeight, rowGap })`; return rows, paths, nodes, column width and height. Keep the fixed row-height coordinate contract in one place.                                                                                                                                                 |
| `lib/gitCommitFileTree.ts`                   | Pure `buildCommitFileItems(files, { mode, collapsedPaths })`; return only visible directory/file rows using normalized paths and compact-folder semantics.                                                                                                                                                                                                               |

Each pure module warrants one focused Vitest file, following `src/lib/gitDiff.ts:17` plus `src/lib/gitDiff.test.ts:4`. Do not add a component test harness solely for this refactor; type-check/build and browser geometry checks cover the component wiring.

### 3. State Ownership

| State                                                                                                                                                                 | Owner                                                         | Reason                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Git snapshots, workspace discovery, refresh/loading, write concurrency and all Git mutations                                                                          | Pinia                                                         | Already canonical and context-safe (`useStore.ts:1097`, `useStore.ts:2293`, `useStore.ts:2657`). Children should call Store actions directly.   |
| AI and external-application preferences                                                                                                                               | Pinia                                                         | Shared by Settings and other views; no component snapshot.                                                                                      |
| Active repository target/context generation, top/repository collapse, split size, global feedback and right diff selection/result                                     | `GitTab.vue` local/module session                             | These coordinate multiple Git regions. Split memory already belongs to `useResizableSplit` (`useResizableSplit.ts:5`).                          |
| Commit draft keyed by repository context                                                                                                                              | `GitTab.vue` module session                                   | It must survive tab remount/repository switching but is not project data (`GitTab.vue:15`, `GitTab.vue:907`). Do not promote it to persistence. |
| Changes open state and history open state                                                                                                                             | Single source in `GitTab.vue`, passed with `v-model`          | Both values affect parent split/layout and section coordination.                                                                                |
| Worktree selection and selected commit hashes                                                                                                                         | Single source in `GitTab.vue`, passed with typed props/events | Worktree selection drives the right diff; commit selection drives history UI and the AI scope. Do not duplicate either inside children.         |
| Staged/unstaged subgroup expansion, textarea DOM sizing and per-file visual action identity                                                                           | `GitChangesPane.vue` local                                    | One view/interaction only.                                                                                                                      |
| Filters/date picker, expanded commit files/directories, list/tree session preference, tooltip details/generations, context menus, ref dialogs and pagination observer | `GitCommitHistory.vue` local/module session                   | Complete history-only UI and lifecycle; current anchors are `GitTab.vue:208`, `GitTab.vue:711`, `GitTab.vue:2539`.                              |
| AI stream/loading/version/composer state and successful renderer-session history                                                                                      | `GitAiAnalysisDialog.vue` local/module session                | The Store owns provider delegation, not dialog presentation (`GitTab.vue:217`, `src/lib/gitAiAnalysisSession.ts:3`).                            |

### 4. Compact Style Acceptance

#### Buttons

- Preserve three deliberate sizes: top repository/network actions `32x32` with 14px icons; section toolbar actions `24x24` with 13px icons; row/bulk actions `20x20` with 12px icons. Current examples are `GitTab.vue:4020`, `GitTab.vue:4329`, and `GitTab.vue:4508`.
- Consolidate repeated Tailwind strings into a small Git CSS class family, not wrapper components. Every icon button keeps stable dimensions in hover/loading states, a Lucide icon, native tooltip/title, `aria-label`, visible `focus-visible`, active/pressed feedback, disabled cursor/contrast, and loading pulse/spinner.
- Inline row actions may reveal on row hover or focus, matching VS Code's hidden-until-hover/focus rule (`scm.css:317`), but keyboard focus and a narrow viewport must still make every action reachable. The action group remains `shrink-0`; no end-justified negative overflow.

#### Inputs

- Commit message, filter and dialog inputs share `ui-field`; compact search/date triggers also use `ui-field-compact` (`index.css:414`, `index.css:430`, `GitTab.vue:4713`).
- Replace the commit textarea's one-off field colors/border with the shared field tokens while preserving auto-grow `32..144px`, `themed-scrollbar`, no horizontal overflow and repository-scoped draft behavior (`GitTab.vue:273`, `GitTab.vue:4380`).
- Acceptance includes explicit primary focus border/ring, readable placeholder in light/dark/host themes (`index.css:443`, `index.css:453`), and disabled/loading text that remains legible.

#### Collapsible Bars

- First-level “更改 / 提交树” bars remain 32px high, 13px chevron, 11px title, 10px count, and 24px right actions (`GitTab.vue:4329`, `GitTab.vue:4563`).
- Second-level staged/unstaged bars remain 28px high, 12px chevron, 10px label/count, and 20px actions (`GitTab.vue:4392`). Chevron comes first, title gets `min-w-0`/truncate, count follows the title, actions are a right-side `shrink-0` sibling.
- Counts are plain compact metadata, not decorative pills. Collapsing changes only content visibility/layout; header height, action positions and focus targets do not jump.

#### Ref And Status Badges

- Dense-row refs stay approximately 18px high with 9px text, 10px icon, small radius/border and a capped/truncated label (`GitTab.vue:3277`, `GitTab.vue:4952`). Do not enlarge rows or cards to fit refs.
- Preserve semantic distinctions for HEAD/local/remote/tag/unknown and the existing compact rule: omit the duplicate local HEAD label, keep one full remote label, then one individually titled icon-only badge per additional remote. Tooltip keeps every full ref.
- Pure ref logic returns semantic kinds only; Vue maps those kinds to Lucide icons and semantic tokens. Light/dark acceptance checks computed foreground/border/background, including neutral unknown refs.

#### Narrow And Theme Checks

- At the narrowest left pane, title/count/actions do not overlap; first and last buttons remain reachable; no container creates negative, non-scrollable start overflow.
- Git graph width follows actual lane span and scrolls horizontally rather than clipping (`GitTab.vue:3679`). Row height and SVG coordinates remain the same fixed pixel constant.
- Verify normal, hover, keyboard focus, active/pressed, disabled and loading states in light, dark and uTools host-like viewport. VS Code is a hierarchy reference, not a pixel target: its history rows are 22px (`scmHistoryViewPane.ts:412`), labels 18px (`scm.css:219`) and inputs use theme/focus tokens (`scm.css:389`, `scm.css:448`).

### 5. Empty Abstractions To Avoid

- No `useGitTab`, `useGitHistory`, `useGitActions` or tooltip composable used by one component; move the complete lifecycle into its owning component.
- No `GitSectionHeader`, `GitIconButton`, `GitBadge`, `GitRow` or date-picker wrapper that only forwards classes/events. A few shared CSS classes are enough.
- No `GitTabContext` mega-object, `provide/inject`, copied Pinia snapshot, action proxy object, or child-owned duplicate selection source.
- No catch-all `gitHelpers.ts`; refs, graph geometry and file-tree flattening have different inputs and tests.
- No class names or Vue icon components in pure lib outputs.
- No per-row/per-badge components and no split based on line count alone.
- No new dependency, store schema, persistence key or bridge API for this refactor.

### Code Patterns

- Existing domain components use typed props/events and own complete UI lifecycle (`GitDiffViewer.vue:8`, `ExternalApplicationLaunchButton.vue:9`).
- Existing pure lib code exports deterministic typed functions and uses focused Vitest (`gitDiff.ts:17`, `gitDiff.test.ts:4`).
- `useResizableSplit` is justified because several tabs share one complete pointer/keyboard/measurement behavior; it is not precedent for one-off Git composables (`useResizableSplit.ts:19`).
- `ProjectDetails` depends only on the current `GitTab` public surface (`ProjectDetails.vue:42`, `ProjectDetails.vue:712`), so internal extraction need not widen the parent contract.

### External References

- None. VS Code evidence comes from the repository-local source snapshot under `references/vscode/`.

### Related Specs

- `.trellis/spec/frontend/component-guidelines.md` — typed props/events, feature-local components, compact Git history, tooltip and context-menu contracts.
- `.trellis/spec/frontend/state-management.md` — Pinia versus local UI/session state and Git write boundaries.
- `.trellis/spec/frontend/type-safety.md` — structured commit refs and mutation contracts.
- `.trellis/spec/frontend/quality-guidelines.md` — semantic tokens, explicit dark-state checks and narrow overflow rules.
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — abstract only real repeated or non-trivial logic.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` reports no active task. This document uses the user-supplied existing task directory and does not change task state.
- `.trellis/spec/frontend/hook-guidelines.md` says no composables exist, but `src/composables/useResizableSplit.ts` is present and documented by the newer component guidelines; actual code/newer guidance takes precedence for this research.
- Research only: no product code, PRD or task metadata was changed, and no runtime/UI regression was executed.
