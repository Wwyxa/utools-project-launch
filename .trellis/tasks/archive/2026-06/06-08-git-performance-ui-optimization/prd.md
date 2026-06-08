# Git 功能性能和 UI 优化

## Goal

优化项目详情页 Git 面板的性能、空间利用和分支/提交切换体验，让 Git 仓库项目打开后自动异步刷新，常用 Git 操作不阻塞界面，并修复从 detached HEAD 回到主分支所在提交后仍停留在 detached HEAD 的问题。

## What I Already Know

- 用户反馈提交详情页顶部 card 占用空间过多，部分信息可移到标题栏。
- 用户反馈从某个 commit checkout 到 detached HEAD 后，再切换回主分支所在 commit，下方 Git 信息仍显示 detached HEAD，需要再手动切换到主分支。
- 用户反馈 Git 功能整体偏慢，优先优化项目详情页打开时自动刷新、工作区变更暂存/取消暂存、提交树底部“加载更多提交”。
- Git 面板主体在 `src/components/project/GitTab.vue`，状态集中在 `src/store/useStore.ts`，真实 Git 命令在 `public/preload.js` 的 `window.projectBridge` 中执行。
- 当前 `refreshGitSnapshot` 会读取 branch/status/files/commits/branches 并持久化项目；暂存/取消暂存成功后会等待完整刷新，导致单文件操作也承担提交日志和分支列表成本。
- 当前 `loadMoreGitCommits` 调用完整 `readGitSnapshot`，即加载更多提交时也会重新读取工作区状态、分支、numstat 等与分页提交无关的数据。
- 当前 `checkoutGitCommit` 始终使用 `git switch --detach <hash>`，如果目标 commit 是本地分支 tip，也会保持 detached HEAD。
- 顶部 Git 面板已有手动刷新按钮和操作消息区域，但项目详情页打开时没有自动触发 Git 快照刷新。

## Assumptions

- “切换回主分支所在 commit”应理解为：如果目标 commit 匹配某个本地分支 tip，优先切换到该分支；若匹配多个分支，优先当前项目记录的分支或当前分支，其次默认分支/主分支，最后第一个匹配分支。
- 自动刷新应在进入项目详情页或 Git 面板可用时异步触发，不阻塞页面打开、文件列表、脚本操作等其他交互。
- 暂存/取消暂存可通过轻量读取工作区文件状态来更新列表，不需要每次重新分页读取提交历史。
- 加载更多提交应只读取下一页提交，并保留当前快照的 files/branches/status/head 信息。
- 本任务不引入新的 Git 库，沿用 preload 中现有 `git` CLI 桥接方式。

## Requirements

- 提交详情弹窗顶部信息重新布局：标题栏显示 commit hash、作者、时间、refs、HEAD 状态等精简元信息，下方内容区减少重复的顶部 card 占用，把空间留给文件列表、commit body 和 AI 分析。
- 从 detached HEAD 选择一个本地分支 tip commit 时，应自动切回对应本地分支，而不是继续 `switch --detach`。
- 如果目标 commit 不是任何本地分支 tip，仍允许以 detached HEAD 方式切换。
- 打开有 Git 仓库的项目详情页时自动触发异步刷新，并提供轻量反馈，例如刷新按钮转动、状态文字或顶部消息，刷新期间不应卡住界面操作。
- 手动刷新仍可用，并应复用同一套刷新状态，避免并发重复刷新同一项目。
- 暂存/取消暂存单个文件或批量文件后，优先做轻量状态刷新或局部更新，避免完整重读提交历史。
- “加载更多提交”只请求下一页提交数据，不能重新读取工作区文件变更和分支列表造成额外等待。
- 优化应保持现有 Git diff、AI 分析、提交、丢弃、分支切换行为可用。

## Acceptance Criteria

- [ ] 项目详情页进入 Git 面板后，对 Git 仓库项目会自动异步刷新一次；刷新期间 UI 可继续操作，并有明确但不占空间的反馈。
- [ ] 手动刷新按钮能够表现刷新中状态，且同一项目刷新不会并发叠加。
- [ ] 暂存/取消暂存单个文件后，文件 staged/unstaged 状态快速更新，不等待提交历史重读。
- [ ] 批量暂存/取消暂存后，文件列表快速更新，并显示合理操作状态。
- [ ] 点击“加载更多提交”只追加提交列表，不重新覆盖当前文件变更、分支、HEAD 等快照信息。
- [ ] detached HEAD 状态下选择主分支或其他本地分支 tip commit，会切回对应分支，Git 信息不再停留 detached HEAD。
- [ ] 非分支 tip commit 仍进入 detached HEAD，并有准确提示。
- [ ] 提交详情弹窗首屏垂直空间减少，关键信息放入标题栏且文本不溢出。
- [ ] `npm run type-check` 通过。

## Definition of Done

- 代码改动符合现有 Vue/Pinia/preload 桥接风格。
- 轻量 Git 读取 API 和类型定义保持 fallback bridge、真实 bridge 一致。
- 不引入阻塞式前端等待或无必要的全量持久化。
- 如发现可复用规范或坑点，更新 Trellis spec 或 repo memory。

## Out of Scope

- 不做远程 fetch/pull/push 性能优化。
- 不重做 Git 图渲染算法或虚拟滚动。
- 不新增新分支创建、merge、rebase 等功能。
- 不改变 AI 分析提示词语义。

## Technical Notes

- `src/components/project/GitTab.vue`：提交详情弹窗、刷新按钮、文件操作、加载更多、checkout commit 交互。
- `src/store/useStore.ts`：`refreshGitSnapshot`、`loadMoreGitCommits`、`stageGitFile(s)`、`unstageGitFile(s)`、`checkoutGitCommit` 等状态流。
- `src/types.ts`：`ProjectBridge` 和 Git 数据类型需要补充轻量读取能力。
- `src/lib/projectBridge.ts`：fallback bridge 需要补齐新增 API。
- `public/preload.js`：拆分 `readGitSnapshot` 中提交分页与工作区状态读取；优化 branch tip 识别和 checkout 行为。
