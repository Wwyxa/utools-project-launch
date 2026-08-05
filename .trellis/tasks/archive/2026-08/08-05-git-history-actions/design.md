# 应用与回退历史提交 - Technical Design

## UI Ownership

`GitCommitHistory.vue` 在现有 commit context menu 中增加两个普通提交动作：

- “Cherry-pick 到当前分支”
- “Revert 此提交”

菜单根据结构化 commit/snapshot 数据禁用当前 HEAD cherry-pick、stash、merge commit、detached HEAD 和 dirty worktree。Preload 仍是最终验证边界。

每个动作先用现有 `ProjectActionDialog` 显示短 hash、标题和准确语义。冲突结果把同一 dialog 切换为 warning，只展示处理建议和关闭操作：文案说明可使用专业 Git 工具，并可在外部应用设置中配置后从 GitTab repository menu 打开。不新增启动按钮、设置跳转或应用选择器。

## Bridge Contracts

新增：

```ts
cherryPickGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>;
revertGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>;
```

merge commit 等前置拒绝继续使用结构化 `ProjectGitActionBlockReason`。冲突与 abort 结果不新增 block reason：组件知道当前执行的是 cherry-pick/revert，只需在普通失败反馈旁显示固定的外部工具提示，不通过 message 文本推断恢复行为。

## Shared Preload Action Flow

两个方法复用一个 preload 内部 helper，而不建立公开通用 Git action API：

1. 找到 repository root，验证 full commit object。
2. 验证 attached local branch、clean status、目标不是 stash 入口且父提交数不大于一。
3. cherry-pick 额外拒绝目标等于当前 HEAD。
4. 确认仓库没有既存的 matching/in-progress operation；发现未知进行中状态时返回普通失败，不自动 abort 别人的操作。
5. 运行 `git cherry-pick <hash>` 或 `git revert --no-edit <hash>`。
6. 失败后仅在对应 `CHERRY_PICK_HEAD` / `REVERT_HEAD` 存在时运行 matching `--abort`。
7. 所有失败都返回普通失败结果：abort 成功时附带“已恢复”说明，abort 失败时同时保留原始 Git 错误与 abort 错误；没有 matching state 时返回原始 Git 错误。

所有 Git 调用使用 argv，不执行 shell 字符串。

## Store And Refresh

- Store actions 通过 `runAuthorizedGitWrite` 重新授权 target。
- 使用 `{ refresh: "full", refs: true, refreshOnFailure: true }`，因为成功、冲突和 abort 失败都可能改变 HEAD/index/refs。
- write lock 覆盖 command、自动 abort 和刷新全过程，避免其他插件操作插入恢复窗口。

## External Tool Guidance

- cherry-pick/revert 失败时统一提示“可使用专业 Git 工具检查或重试”。
- 提示补充“可在设置中配置外部应用，再从仓库菜单打开当前仓库”。
- preload 返回的普通失败信息负责说明自动恢复是否成功；UI 不引入专用恢复状态。
- warning dialog 不调用 Store 外部应用 action；现有外部应用配置与仓库菜单行为保持不变。

## Testing

- `scripts/validate-git-commits.mjs`：成功 cherry-pick/revert、dirty/detached/current/stash/merge 拒绝、真实冲突自动 abort 后 HEAD/index/worktree 等于操作前、模拟 abort 失败时保留两段真实错误。
- `tests/projectBridge.workspace.test.ts`：target 路由和失败仍 full refresh。
- 手动：菜单键盘、确认取消、两种 warning 文案、提示不触发外部应用、窄窗口。
