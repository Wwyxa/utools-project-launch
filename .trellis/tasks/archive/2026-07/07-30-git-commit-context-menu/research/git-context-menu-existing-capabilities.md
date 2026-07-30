# Research: Git 提交上下文菜单现有能力与约束

- **Query**: 完整研究“Git 提交上下文菜单扩展”的现有代码能力与约束；只使用仓库代码和稳定 Git 基础语义，不做外部 web 搜索。
- **Scope**: internal
- **Date**: 2026-07-30

## Findings

### 结论摘要

1. 当前提交行的 `refs` 来自 `git log --all --decorate=short` 的 `%D` 字符串；GitTab 能把它们展示为 HEAD、本地主分支、其他本地分支、远程跟踪 ref、标签和 unknown，但“可切换分支”会再次与 snapshot 的本地 `branches` 精确相交，所以现有提交右键菜单只会出现本地分支。
2. snapshot 的 `branches` 是纯本地分支模型 `{ name, current }`；远程信息只有 remote 配置和当前 upstream，标签没有独立集合。新建标签后无需新增标签状态模型，完整 refs 刷新即可更新提交 decoration。
3. 现有 Git 写操作完整路径是 `GitTab -> Pinia store -> ProjectBridge -> window.projectBridge/preload -> Git -> ProjectGitActionResult -> store 全量/状态刷新 -> GitTab`。`runAuthorizedGitWrite` 已经是 create/rename/delete branch 和 create tag 的最小统一刷新入口。
4. `ProjectActionDialog` 是成熟的纯确认弹窗，不支持文本输入。删除分支应直接复用它；新建分支、重命名分支、新建标签应在 GitTab 内复用一个 mode 驱动的单字段表单弹窗，视觉沿用 GitTab remote 弹窗，交互补齐 Settings 表单已有的 `form`、autofocus、Enter 提交和内联错误模式。没有必要把 `ProjectActionDialog` 泛化成表单框架。
5. 仓库没有现成二级菜单组件。GitTab 当前菜单只做首项聚焦；`ExternalApplicationLaunchButton.vue` 和 `FilesTab.vue` 已提供应复制到 GitTab 的完整键盘/焦点模式，不应新增菜单依赖。
6. Git 允许逗号出现在 ref 名中（本机 `git check-ref-format refs/heads/a,b` 成功），但当前 `refsForCommit` 直接按逗号拆分 `%D`。这是创建合法 ref 后可能立刻暴露的现有解析缺陷，规划必须明确处理。

### Files Found

| File Path                                                    | Description                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/components/project/GitTab.vue`                          | refs 解析与展示、顶部分支菜单、提交菜单、浮层、复制、Git action feedback、确认和 remote 输入弹窗的主实现 |
| `src/components/project/ProjectActionDialog.vue`             | 项目统一的危险/警告确认弹窗，含焦点恢复、Escape、busy 锁定和主/次/取消动作                               |
| `src/components/project/ExternalApplicationLaunchButton.vue` | 仓库内最完整的 menu 键盘入口、方向键、焦点恢复、外点关闭和视口夹取模式                                   |
| `src/components/project/FilesTab.vue`                        | 上下文菜单方向键循环、焦点恢复和 `ProjectActionDialog` 多动作复用模式                                    |
| `src/components/layout/SettingsTab.vue`                      | 带文本输入的 teleported `<form>` 弹窗、autofocus、Enter 提交和字段内联错误模式                           |
| `src/types.ts`                                               | Git snapshot、branch、remote、commit、action result 和 ProjectBridge 契约                                |
| `src/lib/projectBridge.ts`                                   | browser fallback snapshot/action 和 real bridge 选择入口                                                 |
| `src/store/useStore.ts`                                      | 仓库 target 授权、Git mutation/ref 版本、统一写操作和刷新机制                                            |
| `public/preload.js`                                          | 本地 Git 数据读取、写命令、错误提取和 `window.projectBridge` 暴露                                        |
| `src/lib/projectBridge.workspace.test.ts`                    | store 的仓库 target 路由、refs 竞争失效、写后刷新测试                                                    |
| `scripts/validate-git-commits.mjs`                           | 在真实临时 Git 仓库中加载 preload 并验证 commit 元数据的最小脚本                                         |
| `package.json`                                               | lint/build/现有 Git 验证命令入口                                                                         |

## 1. GitTab 现有能力

### 1.1 refs 的来源、解析、分类和展示

#### 仓库事实

- preload 使用 `git log --all --topo-order --decorate=short`，并把 `%D` 原样放入 `ProjectGitCommitSummary.refs`。`--all` 使提交 decoration 可包含本地分支、远程跟踪 refs 和标签；相关实现位于 `public/preload.js:4491`、`public/preload.js:4503`、`public/preload.js:4531`、`public/preload.js:4546`。
- shared type 只把 refs 定义为可选字符串 `refs?: string`，没有结构化 ref 数组或 ref kind；见 `src/types.ts:395`、`src/types.ts:403`。
- GitTab 的 `refsForCommit` 按 `,` 拆分、trim 并过滤空值；见 `src/components/project/GitTab.vue:2755`。
- 分类顺序是：精确 HEAD -> `tag:` -> remote -> known local -> unknown；见 `src/components/project/GitTab.vue:2773`、`src/components/project/GitTab.vue:2782`。
- HEAD 判断是精确 `HEAD` 或 `HEAD -> <non-empty>`，不会把 `remote/HEAD` 误当当前 HEAD；见 `src/components/project/GitTab.vue:2773`。
- remote 判断支持固定前缀 `origin/`、`upstream/`、`remote/`、`remotes/<name>/`，也支持 snapshot 中任意已配置 remote 名；见 `src/components/project/GitTab.vue:2775`。
- local 判断不做字符串猜测，而是与 `snapshot.branches[].name` 精确匹配；只有已知 local `main`/`master` 获得 primary 样式，unknown 保持中性；见 `src/components/project/GitTab.vue:2778`、`src/components/project/GitTab.vue:2814`、`src/components/project/GitTab.vue:2830`。
- dense row 和 rich tooltip 共同调用 `refPresentations`，因此分类和样式不会在两处漂移；行内 refs 位于 `src/components/project/GitTab.vue:4508`，tooltip refs 位于 `src/components/project/GitTab.vue:5130`。
- 当前 refs 徽标是不可点击的 `<span>`，title 是完整原始 ref，label 可截断；见 `src/components/project/GitTab.vue:4508`、`src/components/project/GitTab.vue:4512`。

#### 约束与风险

- `%D` 的逗号分隔不是无歧义协议。Git 接受 `refs/heads/a,b`，而当前 parser 会把它误拆成两个 refs。最稳妥的实现是让 preload 生成可控分隔的 structured refs；最小临时方案是 UI/preload 明确拒绝逗号，但这会拒绝 Git 本身允许的名称，必须作为显式产品限制。
- `refs` 只来自已加载的 commit page。不能用当前 80 条 decoration 判断某个 ref 名在整个仓库是否存在；重名检查必须在 preload 通过 Git 完成。
- remote decoration 是本地 remote-tracking ref，不代表远端服务器实时状态；是否新鲜取决于最近一次 fetch。

### 1.2 提交关联分支和现有右键菜单

- `commitLocalBranchNames` 先收集 snapshot 本地分支名，再将 `HEAD -> x` 归一为 `x`，最后只保留精确命中的本地分支；见 `src/components/project/GitTab.vue:1454`。
- 因此一个提交即使展示 `origin/feature`，现有菜单也不会把它当可切换本地分支。
- 有本地分支时，现有菜单逐条显示“切换到分支”；没有本地分支时只显示“切换到此提交 / 分离 HEAD”；见 `src/components/project/GitTab.vue:5153`、`src/components/project/GitTab.vue:5174`。
- 当前本地分支仍显示在菜单里并标记“当前”；点击后只显示“已经位于分支”反馈；见 `src/components/project/GitTab.vue:1527`、`src/components/project/GitTab.vue:5165`。
- 提交行绑定 `@contextmenu.prevent`。键盘在行内可聚焦子按钮上触发 ContextMenu/Shift+F10 时，contextmenu 事件可冒泡到行；`clientX/clientY === 0` 被识别为键盘入口并以行位置定位；见 `src/components/project/GitTab.vue:4462`、`src/components/project/GitTab.vue:2572`。
- 菜单打开后 `nextTick` 聚焦第一个未禁用 `role=menuitem`；见 `src/components/project/GitTab.vue:2584`。
- 当前提交菜单没有 ArrowUp/ArrowDown/Home/End、ArrowRight/ArrowLeft 或 focusout 处理，也不记录/恢复打开前焦点。

### 1.3 顶部分支菜单

- `branchOptions` 直接使用 snapshot `branches`；fallback 仅在没有分支数组时伪造当前 branch，所以它是本地分支菜单，不是 all refs 菜单；见 `src/components/project/GitTab.vue:324`。
- trigger 和菜单位于 `src/components/project/GitTab.vue:3444`、`src/components/project/GitTab.vue:3458`；菜单有 `role=menu`，条目有 `role=menuitem`，当前项带 Check。
- 顶部分支 trigger 目前没有 `aria-haspopup` / `aria-expanded`，打开后不主动聚焦菜单项，也没有菜单方向键处理。
- 分支切换会在本地已检测到工作区变更时直接打开强制切换确认；否则调用 store。bridge 仍会再次检查，防止 UI snapshot 过期；见 `src/components/project/GitTab.vue:1433`、`src/components/project/GitTab.vue:1387`、`public/preload.js:3238`。

### 1.4 浮层定位、关闭、焦点、Escape 和外部点击

- 顶部分支/remote 菜单使用 trigger rect、固定估算宽高和 8px viewport margin；下方放不下时向上打开；见 `src/components/project/GitTab.vue:555`。
- 提交菜单固定宽 168px，使用存入 state 的估算高度进行 viewport clamp；见 `src/components/project/GitTab.vue:715`。扩展成分组和二级菜单后，现有 `branchCount * 28` 高度估算将不再准确；见 `src/components/project/GitTab.vue:2577`。
- window `pointerdown` 会关闭顶部分支/remote、repository menu 和 commit menu，并通过 data attribute 保留点击中的菜单；见 `src/components/project/GitTab.vue:2588`。
- resize/捕获阶段 scroll 会关闭顶部分支/remote/repository menu，但当前不会关闭 commit menu；见 `src/components/project/GitTab.vue:2600`。滚动历史列表后，commit menu 可能留在旧 viewport 坐标。
- app 级 Escape 的优先级是 tooltip -> commit menu -> remote dialog -> AI dialog -> 其他浮层 -> review panel；见 `src/components/project/GitTab.vue:764`。
- 组件 mount/unmount 正确注册/移除 pointerdown、resize、scroll 和 app Escape listener；见 `src/components/project/GitTab.vue:2648`、`src/components/project/GitTab.vue:2663`。
- 最完整的可复用行为证据在 `ExternalApplicationLaunchButton.vue`：显式 ContextMenu/Shift+F10 入口（`:72`）、实际尺寸二次 clamp（`:44`）、首项/默认项聚焦（`:57`）、方向键/Home/End/Escape（`:93`）、focusout（`:112`）、外点关闭（`:120`）、Escape 后焦点归还（`:128`）。
- FilesTab 也有上下文菜单方向键循环和关闭后 tree node 焦点恢复；见 `src/components/project/FilesTab.vue:488`、`src/components/project/FilesTab.vue:544`。
- 仓库内未找到 `submenu` 或现成的嵌套 menu 组件；新增二级菜单需在 GitTab 内实现 WAI-ARIA menu 语义，但可复用上述行为模式。

### 1.5 剪贴板反馈

- `copyText` 使用 `navigator.clipboard.writeText`，成功后将 `copiedText` 保留 1200ms，失败只清空状态，不向用户显示错误；见 `src/components/project/GitTab.vue:2432`。
- `copyLabel` 只把匹配值的 title/aria-label 从“复制”切换成“已复制”；见 `src/components/project/GitTab.vue:2446`。
- 现有 hash 和 tooltip message 复制按钮使用该机制；refs 徽标尚未接入复制。
- R2 要求“明确但轻量”的成功反馈。最小复用方式是让 `copyText` 返回 success boolean，再由 `copyBranchRef` 同时保留现有 1200ms copied 状态并调用 `setGitActionResult("success", ...)`；失败调用 error。不要再实现第二套 clipboard timer。

### 1.6 Git action result 和确认模式

- GitTab 本地状态为 `idle/loading/success/warning/error`；`setGitActionResult` 同步 action message 和全局 toast，非 loading 结果 2200ms 后隐藏；见 `src/components/project/GitTab.vue:1055`。
- toast 优先于 snapshot/status 刷新消息，因此写操作结果不会被后续刷新立即覆盖；见 `src/components/project/GitTab.vue:598`。
- `isAnyGitWriteRunning` 同时覆盖组件 action、文件 action 和 store 的 `gitWritesInProgress`，是新增菜单项、表单和确认按钮应复用的并发锁；见 `src/components/project/GitTab.vue:1738`。
- 强制切换分支、强制 checkout、丢弃文件、删除 remote 都把动作闭包放进同一个 `confirmationDialog`，最终由 `ProjectActionDialog` 渲染；见 `src/components/project/GitTab.vue:1043`、`src/components/project/GitTab.vue:1317`、`src/components/project/GitTab.vue:1422`、`src/components/project/GitTab.vue:1506`、`src/components/project/GitTab.vue:5006`。
- `confirmRiskyAction` busy 期间防重入，等待 action 完成后关闭；action 自身负责把 Git 失败转成 action result；见 `src/components/project/GitTab.vue:1085`。

## 2. 对话框复用研究

### 2.1 `ProjectActionDialog` 的能力边界

- props 支持 danger/warning、title/message/detail、primary/secondary/cancel、busy 和 busyLabel；见 `src/components/project/ProjectActionDialog.vue:7`。
- 它是 `Teleport to=body` + scale transition + modal dialog；遮罩点击取消；见 `src/components/project/ProjectActionDialog.vue:73`。
- 打开时记录 activeElement 并聚焦主按钮，关闭后恢复焦点；见 `src/components/project/ProjectActionDialog.vue:57`。
- Escape 通过全局 app Escape 协议关闭，busy 时拒绝 Escape/取消；见 `src/components/project/ProjectActionDialog.vue:44`。
- FilesTab 已证明同一组件可承载 save/discard/cancel 和 delete confirm 两种动作组合；见 `src/components/project/FilesTab.vue:1921`。
- 它没有 input、form、slot 或字段错误 API。扩展这些 API 只服务本任务会把一个清晰的确认组件变成表单框架，不符合现有 domain-specific 组件和最小实现约束。

### 2.2 带文本输入弹窗的现有模式

- GitTab remote 弹窗已具备本任务最贴近的视觉、Git action busy 锁、遮罩关闭、header、monospace `ui-field` 和提交按钮；见 `src/components/project/GitTab.vue:4670`、`src/components/project/GitTab.vue:4703`。
- 它的 state 由 `RemoteDialogMode`、draft refs 和 submit handler 驱动；见 `src/components/project/GitTab.vue:107`、`src/components/project/GitTab.vue:216`、`src/components/project/GitTab.vue:955`、`src/components/project/GitTab.vue:989`。
- remote 表单当前不足：没有 `<form>`、autofocus、Enter submit、字段内联错误、`role=dialog`/`aria-modal`；验证错误进入全局 Git toast，而不是字段旁。
- Settings 的 external application 弹窗补齐了这些交互：`Teleport`、`role=dialog`、`<form @submit.prevent>`、autofocus、字段错误样式和内联 message；见 `src/components/layout/SettingsTab.vue:944`、`src/components/layout/SettingsTab.vue:955`、`src/components/layout/SettingsTab.vue:966`。
- Settings 另有手写 delete alertdialog（`src/components/layout/SettingsTab.vue:1147`），但它缺少 `ProjectActionDialog` 的统一焦点/busy/Escape 行为，不是新删除分支流程的推荐复用点。

### 2.3 各动作最合适的 UI 复用点

| 动作       | 最合适复用点                                                                                 | 最小形态                                                                            | 不应做的事                                              |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 新建分支   | GitTab remote dialog 的 Git-local state/busy/视觉 + Settings `<form>`/autofocus/inline error | `RefInputDialogMode = "create-branch"` 的单字段本地弹窗，显示目标 commit short hash | 不扩展 `ProjectActionDialog`；不新建通用 form framework |
| 重命名分支 | 同一个 mode 驱动的 Git ref 输入弹窗                                                          | draft 默认填原分支名并 `select()`；提交 old/new name                                | 不复制第二套弹窗；不允许覆盖已有本地分支                |
| 新建标签   | 同一个 mode 驱动的 Git ref 输入弹窗                                                          | 单字段轻量标签名，显示目标 commit                                                   | 在产品未决定前不增加 message/GPG/annotated tag 编辑器   |
| 删除分支   | `confirmationDialog` + `ProjectActionDialog`                                                 | danger tone，明确 branch、目标 commit/限制；primary 执行 store delete               | 不复用 Settings 手写 alertdialog；不无确认执行          |

建议在 GitTab 内只保留一个输入弹窗 state：`mode | null`、`targetCommit`、`sourceBranch`、`value`、`fieldError`。这是一个组件内三模式表单，不需要新增共享组件。

## 3. Git action 完整调用链与最小新增边界

### 3.1 现有 checkout 调用链

#### 顶部分支或提交关联本地分支

`GitTab.handleSwitchBranch / handleCheckoutCommitBranch`
→ `executeSwitchBranch`
→ `store.switchGitBranch(projectId, branchName, options, target)`
→ `runAuthorizedGitWrite`
→ `bridge.switchGitBranch(repositoryPath, branchName, options)`
→ real preload `switchGitBranch`
→ `git switch [--discard-changes] -- <local-branch>`
→ `ProjectGitActionResult`
→ `refreshGitSnapshot(force) + refreshGitWorkspace(force)`
→ GitTab snapshot/computed 重新渲染。

锚点：`src/components/project/GitTab.vue:1387`、`src/store/useStore.ts:2698`、`src/types.ts:895`、`public/preload.js:3238`、`public/preload.js:4919`。

#### 提交 checkout

`GitTab.handleCheckoutCommit`
→ `store.checkoutGitCommit`
→ store 补充当前 snapshot branch 为 `preferredBranch`
→ preload 校验 hash/dirty tree
→ 若本地 branch tip 指向目标 commit，优先 `git switch <branch>`；否则 `git switch --detach <hash>`
→ refs 全量刷新。

锚点：`src/components/project/GitTab.vue:1475`、`src/store/useStore.ts:2711`、`public/preload.js:2881`、`public/preload.js:3274`。

### 3.2 数据模型事实

- 本地分支：`ProjectGitBranchSummary { name, current }`；见 `src/types.ts:352`。
- remote 配置：`ProjectGitRemoteSummary { name, fetchUrl, pushUrl }`；不是 remote branch 列表；见 `src/types.ts:357`。
- 当前 upstream：`ProjectGitUpstreamSummary { remote, branch, ref, ahead, behind }`；只描述当前本地分支；见 `src/types.ts:363`。
- 标签：没有 snapshot `tags` 数组；只存在 commit `refs` decoration。
- status snapshot 并行读取本地 branches、remotes 和 upstream；`readGitBranchesAsync` 调用不带 `-r/-a` 的 `git branch`，所以 branches 明确只含 local；见 `public/preload.js:2617`、`public/preload.js:4261`、`public/preload.js:4297`。
- browser fallback 明确返回 `branches: []`、`remotes: []`、`upstream: null`；见 `src/lib/projectBridge.ts:519`。
- `ProjectGitActionResult` 已有 `branch`、`commitHash` 和 message 等字段，足以承载 branch 动作；见 `src/types.ts:371`。create tag 如果 UI 只消费 message，不必新增 `tag` 字段。

### 3.3 store 刷新和竞争控制

- `runAuthorizedGitWrite` 先通过 repository target 解析真实 repositoryPath，再递增 project-level write count；见 `src/store/useStore.ts:2570`。
- 成功、部分成功或显式 `refreshOnFailure` 才认为发生变化；见 `src/store/useStore.ts:2583`。
- `refs: true` 会同时提升当前 context mutation version 和 project ref version，并删除同项目其他 related repository snapshot，避免共享 refs 后出现旧历史；见 `src/store/useStore.ts:2585`。
- ref 写操作使用 full refresh；非 main target 还会刷新 main snapshot；workspace 总会刷新；见 `src/store/useStore.ts:2596`。
- full/status/load-more 请求都检查 mutation/ref version，旧请求不能覆盖新 ref 状态；见 `src/store/useStore.ts:2264`、`src/store/useStore.ts:2380`、`src/store/useStore.ts:2422`。
- create branch/create tag/rename branch/delete branch 都属于 ref mutation，应统一使用 `{ refresh: "full", refs: true }`。无需新建事件总线、额外刷新标记或组件主动拼装 snapshot。

### 3.4 最小 ProjectBridge/store/preload 边界

建议四个直接方法，不新增 payload interface、service、factory 或依赖：

```ts
createGitBranch(projectPath: string, branchName: string, commitHash: string): Promise<ProjectGitActionResult>;
createGitTag(projectPath: string, tagName: string, commitHash: string): Promise<ProjectGitActionResult>;
renameGitBranch(projectPath: string, branchName: string, nextBranchName: string): Promise<ProjectGitActionResult>;
deleteGitBranch(projectPath: string, branchName: string): Promise<ProjectGitActionResult>;
```

Store 镜像同名方法，用 `projectId + target` 替换 `projectPath`，全部调用：

```ts
runAuthorizedGitWrite(projectId, target, action, { refresh: "full", refs: true });
```

必须同步修改的边界只有：

1. `src/types.ts` 的 `ProjectBridge` interface。
2. `src/lib/projectBridge.ts` 的 browser fallback（返回明确 unsupported message）。
3. `src/store/useStore.ts` 的四个 proxy action。
4. `public/preload.js` 的四个实现和 `window.projectBridge` 暴露。
5. `src/components/project/GitTab.vue` 的 UI handlers/dialog/menu。

不需要新增 `tags` snapshot 字段；create tag 的 full refresh 会通过 commit decoration 出现。若产品要求“全仓库标签管理/重复名实时预览”，那才需要独立 tags 模型。

### 3.5 preload 最小命令和边界验证

可复用现有 `findGitRoot`、`runGitResult`、`firstGitError`；见 `public/preload.js:1642`、`public/preload.js:1707`、`public/preload.js:2483`。

| 动作                     | 边界验证                                                                                               | 最小 Git 命令                  | 成功后结果                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------- |
| create branch            | repo；非空；`git check-ref-format --branch <name>`；`<hash>^{commit}` 存在；`refs/heads/<name>` 不存在 | `git branch -- <name> <hash>`  | `{ ok: true, branch: name, commitHash, message }` |
| create lightweight tag   | repo；非空；`git check-ref-format refs/tags/<name>`；commit 存在；同名 tag 不存在                      | `git tag -- <name> <hash>`     | `{ ok: true, commitHash, message }`               |
| rename local branch      | repo；old 精确存在于 `readGitBranches`；new 合法；new local branch 不存在；不使用 `-M`                 | `git branch -m -- <old> <new>` | `{ ok: true, branch: new, message }`              |
| safe delete local branch | repo；branch 精确存在；不是当前 branch；不使用 `-D`                                                    | `git branch -d -- <name>`      | `{ ok: true, branch: name, message }`             |

补充约束：

- UI 只做空值和明显状态检查；Git 名称合法性、重复、commit 存在性必须由 preload 再校验。不能依赖已分页 snapshot。
- 所有值通过独立 argv 传给 `spawnSync/execFileSync`，不使用 shell。
- `git check-ref-format` 应成为 ref 名规则的单一权威，不复制一套不完整 regex。
- create/rename 不使用 force；delete 默认 `-d`，保留 Git 的 merged 安全检查。`-D` 需要单独产品授权和更强确认，不应隐式 fallback。
- branch 与 tag 位于不同 namespace，Git 允许同名。是否为了 UI 避免 short-name ambiguity 而跨 namespace 禁止同名，是产品策略，不应伪装成 Git 限制。
- 若保留当前逗号 parser，则需额外拒绝逗号并在 UI 明说这是应用限制；更推荐修正 decoration 传输格式。

## 4. 本地、当前本地、远程跟踪分支的 Git 语义差异

以下来自仓库实际命令模式和本机 Git `branch -h`、`switch -h`、`tag -h` 的稳定语义，无外部搜索。

| ref 类型                                   | 切换                                                                                                                                        | 重命名                                                                                        | 删除                                                                                                                   | UI 结论                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 非当前本地分支                             | `git switch -- <name>`；若工作区变更冲突或该分支在其他 worktree 使用，Git 可拒绝                                                            | `git branch -m <old> <new>`；新名不能已存在（除非 `-M`，本任务不应使用）                      | `git branch -d <name>` 仅在相对适用 upstream/HEAD 已合并时成功；`-D` 强制                                              | 显示切换、重命名、安全删除；bridge 错误必须原样转成可理解结果                                           |
| 当前本地分支                               | 切换到自身是 no-op；现有 UI 已显示“当前”                                                                                                    | Git 支持重命名当前分支，reflog/config 一并移动；`git branch -m <old> <new>` 可用于显式旧/新名 | Git 拒绝删除当前 checkout 分支                                                                                         | 切换禁用/提示当前；重命名技术上可用；删除必须 UI 禁用且 bridge 再拒绝                                   |
| 在其他 linked worktree checkout 的本地分支 | 当前 worktree 不能正常 switch 到已被其他 worktree 占用的分支                                                                                | 受 worktree checkout 状态约束，最终以 Git 命令结果为权威                                      | 即使 force delete 也不应绕过 worktree 使用约束                                                                         | 当前 branch model 没有 worktree path；已知 main/worktree 可从 workspace heads 辅助提示，bridge 必须兜底 |
| 远程跟踪 ref，如 `origin/feature`          | 它不是本地分支。明确方案一：`git switch --track origin/feature` 创建并切换本地跟踪分支；方案二：`git switch --detach origin/feature` 仅查看 | 本地 `branch -m` 不会重命名服务器分支；远端“重命名”通常是创建新远端分支再删旧分支，超出范围   | `git branch -r -d origin/feature` 只删本地 remote-tracking ref，fetch 可恢复；删除服务器分支需要 push delete，超出范围 | 不能复用本地 rename/delete 子菜单。产品必须在“创建本地跟踪分支 / 分离查看 / 只复制”中选择               |

其他稳定语义：

- create-only branch：`git branch <name> <commit>` 只创建 ref，不改变 HEAD 或工作树。
- create-and-switch：`git switch -c <name> <commit>` 会切换 HEAD/工作树，目标是历史提交时会引入 dirty-worktree 风险和强制确认路径。
- lightweight tag：`git tag <name> <commit>` 只创建 tag ref；annotated tag 需要 `-a -m <message>`，签名 tag 还涉及 GPG，均不应在产品未决定前进入最小实现。
- 删除未合并分支：`-d` 返回失败；不应自动重试 `-D`。

## 5. 自动化测试和验证位置

### 5.1 最适合扩展的位置

#### `scripts/validate-git-commits.mjs`

- 已经创建真实临时仓库、生成两次 commit、在 VM 中加载真实 `public/preload.js` 并调用 `window.projectBridge`；见 `scripts/validate-git-commits.mjs:1`、`:13`、`:42`、`:65`。
- 最小做法是直接扩展该脚本验证 refs 和四个新 action，不新建测试框架或 preload mock。
- 建议场景：
  - 从 root commit 创建分支，HEAD 不变，snapshot `branches` 出现新分支，root commit decoration 出现它。
  - 从 root commit 创建 lightweight tag，HEAD 不变，root decoration 出现 `tag: <name>`。
  - branch/tag 空名、非法名、同 namespace 重名失败。
  - rename 后 old local branch 消失、new 出现，commit 指向不变。
  - rename 当前分支成功并更新 `snapshot.branch/current`（若产品允许）。
  - 删除当前分支失败。
  - `-d` 删除已合并非当前分支成功；删除未合并分支失败且分支保留。
  - 合法逗号 ref 的 parser 行为按最终策略验证：structured parsing 正确，或应用边界明确拒绝。

#### `src/lib/projectBridge.workspace.test.ts`

- 已覆盖 exact repository target 路由、main/worktree/submodule 写隔离、refs mutation 使旧 snapshot 失效、写后 workspace/full refresh；见 `src/lib/projectBridge.workspace.test.ts:480`、`:530`、`:581`。
- 在“routes writes to the exact authorized repository”用例中增加四个 bridge spy，断言参数使用 active repositoryPath，并断言每个动作触发 full snapshot/workspace refresh。
- 在 stale target 用例中增加四个 action，断言 target 失效时 bridge 不被调用。
- 至少为一个新 ref action增加 race 断言即可证明它复用 `refs: true`；不必给四个同构 action复制四套 race 测试。

### 5.2 UI 自动化现状与可验证场景

- 仓库已安装 Vitest，但没有 Vue Test Utils、Playwright 或 GitTab component test harness；`package.json:22`。
- 不建议只为本任务引入 UI 测试依赖。preload/store 逻辑自动化后，以下交互做手工 host/browser smoke：
  - 鼠标右键与 ContextMenu/Shift+F10 打开相同菜单。
  - ArrowUp/Down/Home/End 在主菜单循环；ArrowRight/hover 打开 branch submenu；ArrowLeft/Escape 先退子菜单再退主菜单；关闭后焦点归还触发项。
  - 外部点击、window resize、历史滚动关闭菜单。
  - 多分支、长名、右/下视口边缘不越界，主/子菜单各自可滚动且单行。
  - branch badge 点击复制完整本地/远程名，截断 title 保留完整名，成功和失败有明确反馈。
  - 当前分支删除禁用；未合并/其他 worktree 分支的 Git 拒绝信息可理解。
  - create/rename/tag 的 autofocus、Enter submit、Escape、busy 防重复、内联错误和写后 decoration 刷新。

### 5.3 完成实现后的最小命令集

- `node --check public/preload.js`
- `npm run validate:git-commits`
- `npx vitest run src/lib/projectBridge.workspace.test.ts`
- `npm run type-check`
- `npm run build`

如果修改 package script 名称或拆出新 Git refs 脚本，再更新 `package.json`；否则扩展现有命令最省文件。

## 6. 最小实现建议

### 建议的信息架构

1. 提交菜单第一组固定两个 action：新建分支、新建标签。
2. separator。
3. 无关联 branch ref：保留现有“切换到此提交 / 分离 HEAD”。
4. 有关联 branch ref：本地和 remote 分开展示，每个 branch 主项使用完整可复制 badge，并可进入 submenu。
5. local submenu：切换、重命名、安全删除。
6. remote submenu：只放用户最终选择的 remote 语义；绝不显示 local rename/delete。

### 建议的代码改动顺序

1. 在 GitTab 内把 `commitLocalBranchNames` 提升为返回 structured branch ref presentation（local/remote/current/displayName/refName）；继续复用现有 `refPresentation`，不创建全局 model。
2. 按 `ExternalApplicationLaunchButton` 模式补齐主/子菜单触发元素、roving focus、Escape 层级、focus restore、focusout、pointerdown、resize/scroll 和 actual-size clamp。
3. 增加一个 mode 驱动 ref input dialog；创建/重命名/tag 共用模板和 submit handler 分派。
4. 删除 branch 继续走 `confirmationDialog`/`ProjectActionDialog`。
5. 在 types/fallback/store/preload 增加四个最小方法，store 全部复用 full+refs refresh。
6. 扩展真实 Git 脚本和 workspace store test。

### 明确跳过

- 不新增菜单框架、表单框架或运行时依赖。
- 不新增独立 tags snapshot，除非未来要做全仓库标签浏览/管理。
- 不实现 remote server branch rename/delete。
- 不实现 force rename (`-M`) 或 force delete (`-D`)。
- 不实现 annotated/signed tag，除非产品明确选择。
- 不把纯 UI 菜单状态放入 Pinia。

## 7. 关键风险

1. **refs 逗号歧义**：Git-valid ref 可被现有 `split(",")` 误解析；这是最直接的数据正确性风险。
2. **local/remote 混淆**：commit decoration 显示 remote 不等于 snapshot `branches` 有该 local branch；动作必须依赖 kind，而不是 label/prefix 猜测。
3. **worktree 占用**：当前 branch model 只有 `current`，不能完整表达“在另一个 worktree checkout”。bridge 必须以 Git 错误兜底；若 UI 必须预先禁用所有这类项，可再给 branch summary 增加可选 worktree path，这不是四个动作的首要最小边界。
4. **分页不能做重名权威**：当前 commit page/tag decoration 不完整，所有冲突检查必须在 preload。
5. **create-and-switch 扩大风险**：从历史提交创建并立即切换会改变 worktree，必须进入现有 dirty/force 确认；create-only 不会。
6. **安全删除语义**：`-d` 可能因未合并而失败，这是保护而非异常；message 应明确，不能自动升级 `-D`。
7. **浮层估算失准**：现有 commit menu 用估算高度；加入分组/子菜单后必须按实际 DOM 尺寸 clamp，且 scroll 时关闭或重定位。
8. **焦点层级**：当前 commit menu 无方向键和焦点恢复；二级菜单若只做 hover，会违反键盘验收。
9. **复制失败沉默**：现有 helper catch 后无反馈；新增可点击 badge 时必须处理 failure。
10. **branch/tag 同名**：Git 允许跨 namespace 同名，但 short name 可能歧义；是否额外禁止是产品策略。

## 仓库事实 vs 仍需用户决定

### 已确认的仓库事实

- `branches` 只有本地分支；remote branch 和 tag 只能从 commit `refs` decoration 识别。
- 当前提交菜单只展示关联本地分支；没有 local branch 时才提供 detached checkout。
- preload checkout commit 已会优先切到指向目标 commit 的本地分支，否则 detached。
- 所有新增 refs 写操作都有现成的 store full+refs 刷新和竞争保护入口。
- `ProjectActionDialog` 适合删除确认，不适合文本输入。
- GitTab remote dialog + Settings form 是文本输入弹窗的现有组合模式。
- 仓库没有 submenu 组件；有可直接借鉴的 menu 键盘/焦点实现。
- Git 支持重命名当前本地分支，但拒绝删除当前分支。
- remote-tracking ref 不能套用本地 rename/delete 语义。

### 仍需用户决定的产品问题

1. 新建分支后只创建，还是立即切换？建议最小版本只创建；立即切换会引入历史 commit + dirty worktree 风险。
2. 新建标签只做 lightweight，还是支持 annotated message/GPG？建议最小版本只做 lightweight。
3. remote branch submenu 提供什么：
   - 创建并切换本地 tracking branch（建议默认候选）；
   - detached 查看 remote ref；
   - 仅复制，不提供切换。
4. 是否允许重命名当前分支？Git 支持，建议允许；删除当前分支必须禁用。
5. 删除未合并分支是否永远只做安全 `-d`，还是后续另加 force delete？建议本任务只做 `-d`。
6. branch/tag 跨 namespace 同名是否允许？Git 允许；若禁止，需要把它定义为应用 UX 规则。
7. 逗号合法 ref 如何处理：修正 decoration 传输格式（推荐），还是明确限制名称不能含逗号（更小但不完整）。

### Related Specs

- `.trellis/spec/frontend/component-guidelines.md` — Git refs 分类、compact history、teleported floating UI、Escape 和无障碍约定。
- `.trellis/spec/frontend/state-management.md` — `Vue -> Pinia -> ProjectBridge -> preload` 边界、Git write/ref refresh 约定。
- `.trellis/spec/frontend/type-safety.md` — shared Git contracts 和 preload bridge 类型必须集中在 `src/types.ts`。
- `.trellis/spec/frontend/quality-guidelines.md` — 浮层 fixed positioning、viewport、build/type-check 验证约定。
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — 跨层格式、验证所有权和错误回传检查。
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — 优先复用现有 dialog/menu/store helper，避免一次性框架。

### External References

- 无。按任务要求未做 web 搜索；Git 语义由仓库现有命令和本机 `git branch -h`、`git switch -h`、`git check-ref-format -h`、`git tag -h` 核对。

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` 当前返回无 active task，但用户明确指定且目录已存在，因此研究写入该唯一明确路径；未修改 task 指针或 task 元数据。
- `trellis mem search "git context menu branch tag rename"` 未找到历史会话命中；当前构建的 OpenCode 历史 reader 暂不可用。本文不依赖历史会话结论。
- 未找到 GitTab/component 级自动化测试基础设施；菜单焦点、二级浮层和 viewport 行为目前只能通过 build + 手工 smoke 验证，除非后续产品决定引入 UI 测试工具。
- 对“另一个 worktree 正在使用某本地分支”的 UI 预禁用，现有 branch summary 信息不足以对所有 repository target 完整判断；Git bridge 命令仍可可靠拒绝并返回原因。
