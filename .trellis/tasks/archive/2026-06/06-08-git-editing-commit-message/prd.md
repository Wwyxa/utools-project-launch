# Git 操作与提交信息生成

## Goal

在项目详情页 Git tab 中加入轻量 Git 编辑能力，让用户可以在不离开启动器的情况下完成常见本地 Git 操作：整理工作区变更、生成并提交 commit message、切换分支以运行旧版本命令；同时压缩提交树左侧选择列，减少无效空间占用。

## What I Already Know

- 当前 Git tab 已展示分支、ahead/behind、工作区变更文件、提交树、提交筛选和 AI 生成入口。
- 当前工作区文件列表支持点击查看 diff、打开文件；没有 stage、unstage、discard、commit、branch switch 等写操作。
- 当前 AI 生成入口会分析提交记录与工作区变更文件清单，但不读取完整工作区 diff，也没有专门输出 commit message 的模式。
- 当前桥接层只暴露 Git 读接口：snapshot、file diff、commit file diff、commit files。
- preload 已有 `findGitRoot`、`runGit`、`runGitDiff` 等 Git CLI 封装，可在其基础上增加受控写操作。
- 用户新增要求：分支切换也纳入本次任务，便于切换回之前版本运行命令。
- 用户新增要求：提交树左侧单选/选择按钮列宽变小，减少无效空间占用。

## Requirements

- Git tab 工作区变更区支持文件级 stage / unstage 操作。
- Git tab 支持 discard 单个工作区文件变更，但必须有明确确认，避免误删本地修改。
- Git tab 支持输入 commit message，并提交 staged 变更。
- Git tab 支持 AI 根据当前工作区变更生成 commit message。
- AI commit message 生成应优先分析 staged diff；如果没有 staged 变更，则分析全部工作区 diff。
- AI commit message 生成结果应方便用户复制或填入 commit message 输入框。
- Git tab 支持展示本地分支列表并切换分支。
- 分支切换遇到未提交变更时应阻止切换，并提示用户先提交、暂存或丢弃变更。
- 分支切换后应刷新 Git snapshot，并让项目运行命令自然使用切换后的工作树版本。
- 提交树左侧选择按钮列应缩窄，保持可点击和可读，但减少横向空间浪费。
- Git 写操作完成后刷新当前 Git 状态、文件列表和提交列表。
- 浏览器预览 fallback 应保持可用，对 Git 写操作返回不可用提示。

## Acceptance Criteria

- [ ] 用户可以从 Git tab 对单个变更文件执行 stage，并看到状态刷新。
- [ ] 用户可以从 Git tab 对单个 staged 文件执行 unstage，并看到状态刷新。
- [ ] 用户对单个文件执行 discard 前会看到确认，确认后变更消失或状态刷新。
- [ ] 用户可以填写 commit message 并提交 staged 变更；提交成功后工作区与提交树刷新。
- [ ] 没有 staged 变更时，commit 操作不可执行或给出清晰提示。
- [ ] 用户可以点击 AI 生成 commit message，并将结果填入 commit message 输入框。
- [ ] AI commit message 的提示词包含 diff 内容摘要，而不仅是文件名清单。
- [ ] 用户可以查看本地分支列表并切换到目标分支。
- [ ] 工作区有未提交变更时，分支切换会被阻止并显示清晰提示。
- [ ] 分支切换成功后当前分支、提交树、工作区变更刷新。
- [ ] 提交树左侧选择列宽比当前更紧凑，文本不重叠，选择按钮仍易点击。
- [ ] `npm run type-check` 通过。
- [ ] `npm run build` 通过。

## Definition of Done

- TypeScript 类型覆盖新增 bridge 接口和 store 方法。
- Git 写操作限制在当前仓库根目录下执行，不接受任意 shell 拼接。
- 风险操作有确认或清晰失败提示。
- UI 与现有 Git tab 的紧凑工具型风格一致。
- Spec 是否需要更新已评估；如产生新约定则写入 `.trellis/spec/`。

## Technical Approach

- 在 `public/preload.js` 增加受控 Git 写接口，优先使用 `execFileSync("git", ["-C", repo, ...args])` 参数数组，不拼 shell 字符串。
- 在 `src/types.ts` 扩展 `ProjectBridge` 类型，新增 Git action result、branch summary、commit message generation 所需数据类型。
- 在 `src/lib/projectBridge.ts` fallback bridge 中补齐新增接口，浏览器预览返回不可用提示。
- 在 `src/store/useStore.ts` 增加 store actions，统一调用 bridge 并在成功后刷新 Git snapshot。
- 在 `src/components/project/GitTab.vue` 增加：文件 action 按钮、commit message 输入区、AI commit message 生成入口、分支切换控件，并压缩提交树选择列宽。
- AI commit message 生成使用现有 `analyzeGitWithAiStream` 流程；新增专门 prompt builder，读取 staged 或工作区 diff 的有限长度摘要。

## Decision (ADR-lite)

**Context**: Git tab 已有本地 Git 状态读取和 AI 分析能力，但缺少写操作；用户希望从只读视图升级为轻量操作面板。

**Decision**: 采用小闭环 Git 操作，而不是完整 Git 客户端。先覆盖 stage / unstage / discard / commit / branch switch / AI commit message，不做 merge、rebase、push、pull、stash 管理等复杂工作流。

**Consequences**: 实现范围可控，用户能完成最常见本地准备与版本切换；未来如加入 push/pull/stash，可继续沿用 bridge action + store refresh + compact toolbar 的模式。

## Confirmed Decisions

- 分支切换遇到未提交变更时默认阻止切换，并提示用户先提交、暂存或丢弃。这避免把本地改动带到另一个分支、触发冲突，或让用户误以为已经回到干净旧版本。

## Out of Scope

- 不做 push / pull / fetch / merge / rebase。
- 不做 stash 管理，除非后续明确加入。
- 不做远程分支创建或远程分支 checkout。
- 不做多文件批量选择提交规划；本次以单文件 stage/unstage 和当前 staged commit 为主。
- 不改项目脚本运行逻辑；分支切换后现有命令自然运行当前工作树版本。

## Technical Notes

- Likely impacted files:
  - `src/components/project/GitTab.vue`
  - `src/store/useStore.ts`
  - `src/types.ts`
  - `src/lib/projectBridge.ts`
  - `public/preload.js`
  - possibly `src/lib/i18n.ts`
- Existing Git read functions:
  - `public/preload.js`: `readGitSnapshot`, `readGitFileDiff`, `readGitCommitFileDiff`, `readGitCommitFiles`
  - `src/store/useStore.ts`: `refreshGitSnapshot`, `readGitFileDiff`, `readGitCommitFiles`
- Existing AI modes are general summary/analysis/evaluation; commit message generation should be a dedicated Git tab action, not just another generic analysis mode.
- Existing project scripts: `npm run type-check`, `npm run build`, `npm run validate:ai-reasoning`.

## Iteration Feedback 2026-06-08

### Layout Corrections

- Current first implementation overly compresses the left changed-files column in the default small uTools window.
- The Git tab must optimize for compact plugin windows: left changed-files rows, action buttons, commit message input, and AI helper text must remain readable and usable.
- It is acceptable to modestly increase the left column width, but the commit graph must further reduce wasted fixed-column space.
- Compress the commit graph checkbox/selection column, graph lane area, hash column, and row padding so the message column gets more effective width.

### Commit Checkout

- Besides branch switching, the Git tab must support switching directly to a selected commit, matching common Git management tools.
- Prefer putting the action in the commit detail dialog to avoid adding a complex right-click menu in the small uTools window.
- Switching to a commit enters detached HEAD and must refresh branch/status, changed files, and commit graph afterward.
- If there are uncommitted changes, switching to a commit must be blocked with a clear in-app message, same as branch switching.
- The UI should clearly indicate detached HEAD / current commit state after checkout.

### Discard Confirmation UX

- Replace the discard/trash icon with a revert/undo-style icon similar to VS Code's Git discard action.
- Do not use `window.confirm` or uTools native confirmation for discard; native dialogs can make the plugin UI disappear.
- Implement an in-app confirmation dialog that matches the current UI style, works in light and dark themes, and is structured for future reuse by other risky actions.

### Added Acceptance Criteria

- [ ] Default small uTools window width keeps the left changed-files area usable; file names, action icons, and commit controls do not collide or become unreadable.
- [ ] Commit graph fixed columns are visibly tighter than the first implementation while selection buttons remain clickable.
- [ ] Commit detail includes a “switch/checkout to this commit” action.
- [ ] Checkout commit is blocked when the working tree has uncommitted changes.
- [ ] Detached HEAD / checked-out commit state is visible after checkout.
- [ ] Discard uses a revert/undo-style icon.
- [ ] Discard confirmation is an app-rendered dialog, not a native confirm, and matches light/dark theme tokens.

## Iteration Feedback 2026-06-08 Round 2

### Left Sidebar Density

- The changed-files sidebar still needs to be more compact in the default uTools window.
- Move file action buttons into the changed-files title/header row where possible, or otherwise collect controls into the same compact header/action band, so individual rows and commit controls use less vertical and horizontal space.
- Remove helper text such as “根据 staged diff 生成提交信息；没有 staged 变更时使用全部工作区 diff。” because it consumes valuable space without adding necessary interaction value.
- Keep the layout readable with multiple changed files: file name, status, additions/deletions, and available actions should remain discoverable without forcing large row heights.

### Stage / Unstage Responsiveness

- Optimize “暂存文件” and “取消暂存” click responsiveness. The current implementation feels blocked or laggy after clicking an action button.
- Prefer an immediate local loading state plus refresh after the Git action completes, and avoid unnecessarily expensive synchronous UI work before showing feedback.
- Disable only the relevant file/action where practical instead of making the whole Git panel feel frozen.

### AI Commit Message Generation UX

- AI commit message generation should write the generated final content directly into the commit message textarea.
- Do not show a separate generated-result text box in the left sidebar.
- Do not write model reasoning/thinking content into the commit message textarea; only final content should be applied.
- During generation, use compact status feedback on the existing AI button / Git action message area instead of adding a large result panel.

### Configurable Commit Prompt

- Make the prompt used for commit message generation configurable from Settings, using the same AI mode/prompt-settings area.
- The commit-message prompt should be a dedicated mode/config entry rather than hard-coded in `GitTab.vue`.
- Defaults should still produce a concise, directly usable Git commit message and can reference the injected diff scope/content.

### Added Acceptance Criteria

- [ ] Left sidebar header/action layout is compact enough for default uTools window size; no unnecessary helper paragraph remains under AI commit generation.
- [ ] File row actions no longer cause obvious UI freeze before visual feedback appears.
- [ ] AI commit message generation directly fills the commit textarea with final content only.
- [ ] AI reasoning/thinking is not copied into the commit message field.
- [ ] Commit message prompt is configurable in Settings alongside existing AI mode settings.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 3

### VS Code Source Control Density Reference

- The current Git left sidebar layout still wastes too much space and does not feel as efficient as VS Code Source Control.
- Redesign the Git changed-files/commit area toward a VS Code-like compact source-control panel:
  - Commit input should be at the top of the sidebar with minimal surrounding chrome.
  - Commit and AI-generate controls should be compact, adjacent to the commit input area, and avoid card-like vertical padding.
  - Changed-files group header should show count and file-level actions in a single dense toolbar row.
  - File rows should be compact single-row or near-single-row items where possible: filename, path/status, diff counts, and actions should not create large vertical whitespace.
  - Prefer icon-only actions with tooltips/labels over visible explanatory text.
  - Avoid repeated borders/cards inside the sidebar; use subtle section dividers like VS Code rather than stacked cards.
- Preserve existing functionality: selected-file actions, open diff, open file, stage/unstage/discard, AI commit message generation, commit staged changes, and Git action feedback.
- Default uTools window size is the target viewport; the layout should be judged at small plugin dimensions, not only wide desktop.

### Added Acceptance Criteria

- [ ] Git sidebar visually resembles a compact source-control panel rather than stacked cards.
- [ ] Commit input, commit button, AI generate button, changed-files header, and file list fit comfortably in the default uTools window without unnecessary explanatory text.
- [ ] Changed-file rows are denser than the previous two-line/card-like layout while retaining enough information to identify files.
- [ ] File actions are discoverable through icon buttons/tooltips and do not consume large row width when not needed.
- [ ] Stage/unstage/discard/open-file actions still work after the layout rewrite.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 4

### Commit Prompt As A Fixed Mode

- The commit message prompt should reuse the existing AI mode settings structure as a fixed mode, instead of being rendered as a separate prompt editor panel.
- Add/represent a fixed built-in commit-message mode in the AI modes list so users configure it the same way they configure other modes.
- The commit-message mode should not appear as a selectable mode for normal Git history AI summary/evaluation flows unless explicitly intended for commit message generation.
- The Git commit-message generator should read the fixed commit-message mode prompt from AI preferences.

### Bulk Toolbar Semantics

- The changed-files title/header toolbar actions should apply to all eligible changed files, not to the currently selected file.
- Header add/stage should stage all unstaged/eligible files.
- Header unstage should unstage all staged files.
- Header discard should discard all changed files only after the app-rendered confirmation dialog.
- Header stage/unstage should show only the action that currently makes sense where possible; do not show both as competing primary actions when only one is relevant.

### Row Hover Actions

- Each changed-file row may expose add/stage, unstage, and discard actions, but like VS Code Source Control they should normally stay hidden and appear on hover/focus for that row.
- For each row, stage and unstage should share one action slot: show stage when the file has unstaged changes, show unstage when the file is staged and has no unstaged changes, and avoid showing both unless there is a clear mixed-state reason.
- Clicking the row itself continues to open diff preview; row action buttons must stop propagation.

### Added Acceptance Criteria

- [ ] Settings shows commit message prompt as a fixed AI mode using the same mode editor structure, not a separate prompt box.
- [ ] Normal Git AI analysis mode pickers do not accidentally offer the commit-message mode.
- [ ] Changed-files header stage/unstage/discard actions operate in bulk across eligible files.
- [ ] Header stage/unstage action presentation avoids showing both buttons as unrelated actions when a single contextual action is clearer.
- [ ] File row stage/unstage/discard actions appear on hover/focus and do not consume row width in the normal state.
- [ ] Row stage/unstage uses one contextual action slot.
- [ ] Clicking a file row still opens diff; clicking a row action does not open diff.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 5

### More Compact Change Header

- Do not show successful stage/unstage messages such as “已暂存文件变更。” because they make the compact Git sidebar jump vertically.
- The changed-files header label should be shortened from “变更文件” to “变更”.
- Remove changed-file total count from the header; W/S counts are enough.
- Remove changed-files scroll-to-top and scroll-to-bottom buttons from the header to reduce unused controls.

### Commit Prompt Placeholder Help

- In Settings, for the fixed commit-message AI mode, add a small help button next to the “提示词” title.
- Hovering/focusing the help button should show all supported placeholders: `{diffScope}`, `{diffContent}`, and `{truncatedNote}`.

### Added Acceptance Criteria

- [ ] Stage/unstage success does not render a status message that changes sidebar height.
- [ ] Changed-files header reads “变更”, does not show total changed-file count, and does not include scroll-to-top/bottom buttons.
- [ ] W/S counts remain visible when applicable.
- [ ] Commit-message mode prompt editor shows placeholder help next to the prompt title.

## Iteration Feedback 2026-06-08 Round 6

### Prompt Placeholder Help For All Modes

- The placeholder help button should appear beside the `提示词` title for every AI prompt mode, not only the fixed commit-message mode.
- The help content must distinguish placeholders that work in all Git AI prompts from placeholders that are specific to commit-message generation.
- Do not imply `{diffScope}`, `{diffContent}`, or `{truncatedNote}` are universally available unless runtime support is added for the current prompt flow.

### Generic Placeholder Runtime Support

- Normal Git batch analysis and commit detail analysis prompts should support generic placeholders where practical, so the settings UI help maps to real runtime behavior.
- Useful generic placeholders include repository / branch / status / changed-files / commit-list or selected commit fields, depending on the flow.
- Commit-message generation keeps its diff placeholders: `{diffScope}`, `{diffContent}`, `{truncatedNote}`.

### Added Acceptance Criteria

- [ ] Every prompt editor in Settings has a placeholder help button next to `提示词`.
- [ ] Placeholder help lists generic Git AI placeholders and separately marks commit-message-only placeholders.
- [ ] Git batch analysis mode prompts replace supported generic placeholders at runtime.
- [ ] Commit detail AI mode prompts replace supported generic placeholders at runtime.
- [ ] Commit-message mode continues replacing `{diffScope}`, `{diffContent}`, and `{truncatedNote}`.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 7

### Prompt Context Strategy

- The placeholder help tooltip in Settings is visually broken in the compact uTools window: native title plus custom tooltip can appear together, the popover is clipped, and the pointer cannot move onto it reliably.
- Do not expose prompt placeholders as a primary Settings interaction anymore.
- Keep prompt editors focused on general instructions. Runtime Git AI flows should append the required repository / commit / file context automatically instead of requiring users to insert placeholders into prompt templates.
- Remove the current prompt placeholder help button / tooltip from Settings.
- Existing placeholder replacement may remain as backward compatibility for old saved prompts, but default prompts and Settings guidance should not encourage users to write placeholder tokens.

### Optional Diff Context

- For the two Git AI analysis entry points, make code diff attachment optional with a compact control:
  - Batch Git AI generation dialog.
  - Commit detail AI generation panel.
- The control should be small (button, toggle, or checkbox) and not add large explanatory text.
- Keep necessary non-diff context automatically attached in both flows.
- When diff attachment is disabled, prompts should still include commit metadata / selected commit list and changed-file names where appropriate, but should not append full code diff content.
- Commit-message generation remains diff-based and should continue attaching the staged/working-tree diff automatically, because diff is essential for drafting a commit message.

### Added Acceptance Criteria

- [ ] Settings prompt editor no longer shows the placeholder help icon or tooltip.
- [ ] Default prompt editing UX no longer asks users to manually insert placeholder tokens.
- [ ] Batch Git AI generation always receives the necessary selected/filter commit context automatically.
- [ ] Commit detail AI generation always receives the necessary selected commit context automatically.
- [ ] Batch Git AI generation has a compact option to include/exclude code diff context.
- [ ] Commit detail AI generation has a compact option to include/exclude code diff context.
- [ ] When diff context is disabled, the generated prompt excludes full code diff content while preserving useful metadata context.
- [ ] Commit-message generation still automatically includes the diff needed to draft the message.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 8

### Commit Message Editor Readability

- The Git sidebar commit message textarea is too short when AI generates or users write multi-line commit messages.
- Improve readability without losing the compact VS Code Source Control-style layout.
- Prefer an adaptive textarea that stays compact for one-line messages but grows for multi-line content up to a bounded maximum, then scrolls internally.
- The commit action and AI-generate buttons should remain close to the textarea and easy to reach.
- The changed-files list should still keep usable space in the default uTools window.

### Added Acceptance Criteria

- [ ] One-line commit messages keep the Git sidebar compact.
- [ ] Multi-line commit messages are easier to read than the fixed small textarea.
- [ ] The textarea growth has an upper bound and does not push the changed-files list out of practical use.
- [ ] Commit and AI-generate controls remain adjacent to the editor.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 9

### Commit Message Action Buttons

- The commit and AI-generate buttons should be stacked vertically beside the commit message textarea.
- Vertical buttons reclaim horizontal textarea space in the narrow Git sidebar, making long generated commit messages easier to read.
- The textarea minimum height should visually align with the stacked button column so the compact header does not look unbalanced.

### Added Acceptance Criteria

- [ ] Commit and AI-generate buttons are vertically stacked beside the commit message textarea.
- [ ] The textarea gets more horizontal room than the horizontal-button layout.
- [ ] The textarea minimum height aligns with the stacked button column.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 10

### Commit Detail Checkout Feedback

- In the commit detail dialog, clicking the checkout/switch action while there are uncommitted working-tree changes should show an app-rendered dialog message.
- Do not surface this blocked-checkout message in the Git sidebar action/status area under the commit message editor.
- The commit detail checkout action text should be shorter than “切换到此提交”.
- The top metadata/action area in commit detail should be visually calmer: less competing text, clearer grouping between commit metadata, hash/copy, checkout action, and refs.

### Added Acceptance Criteria

- [ ] Blocked checkout from commit detail opens an app-rendered dialog or alert-style modal.
- [ ] Blocked checkout does not write a warning into the Git sidebar action/status message area.
- [ ] Commit detail checkout button uses shorter visible text.
- [ ] Commit detail top area has clearer grouping and less visual clutter.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 11

### Commit Sidebar Status Noise

- Do not show any action/status hint under the commit message textarea.
- The compact sidebar should rely on refreshed state, disabled/loading button states, and the top Git status pill for feedback.
- Messages such as successful checkout, detached HEAD notices, or blocked actions should not appear directly under the commit message editor.

### Force Branch Switch Confirmation

- When switching branches with uncommitted working-tree changes, show an app-rendered confirmation dialog instead of silently blocking.
- The dialog must clearly say that forced switching will discard current uncommitted changes.
- Confirming should force the branch switch and refresh Git snapshot afterward.
- Cancelling should keep the current branch and working tree unchanged.
- The bridge should keep the safe default behavior unless the caller explicitly requests forced switching.

### Added Acceptance Criteria

- [ ] No status/message row is rendered under the commit message textarea.
- [ ] Branch switching with uncommitted changes opens an app-rendered confirmation dialog.
- [ ] Confirming the dialog force-switches to the selected branch and refreshes the Git state.
- [ ] Cancelling the dialog does not switch branches or discard changes.
- [ ] The Git bridge defaults to non-forced branch switching unless force is explicitly requested.
- [ ] Type-check and build continue to pass.

## Iteration Feedback 2026-06-08 Round 12

### Force Commit Checkout Confirmation

- Commit checkout should match branch switching behavior when the working tree has uncommitted changes.
- Clicking the commit detail “切换” action with uncommitted changes should open an app-rendered danger confirmation dialog instead of only warning/blocking.
- The dialog must clearly say forced checkout will discard current uncommitted changes and enter detached HEAD at the selected commit.
- Confirming should force checkout to the selected commit and refresh Git snapshot afterward.
- Cancelling should keep the current HEAD and working tree unchanged.
- The bridge should keep the safe default behavior unless the caller explicitly requests forced checkout.

### Added Acceptance Criteria

- [ ] Commit checkout with uncommitted changes opens an app-rendered danger confirmation dialog.
- [ ] Confirming the dialog force-checks out the selected commit and refreshes Git state.
- [ ] Cancelling the dialog does not switch commits or discard changes.
- [ ] The Git bridge defaults to non-forced commit checkout unless force is explicitly requested.
- [ ] Type-check and build continue to pass.
