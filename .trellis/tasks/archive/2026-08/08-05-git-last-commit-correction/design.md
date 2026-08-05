# 修正与撤销最近提交 - Technical Design

## UI Ownership

`GitChangesPane.vue` 继续拥有提交输入、提交按钮、工作区写操作和局部确认状态。

- 在现有 Changes toolbar 加一个 More 图标菜单，包含“修订上次提交”和“撤销上次提交”；不新增常驻面板或解释卡片。
- More 菜单使用现有 teleported compact menu、outside click、Escape 和 viewport clamp 模式。
- amend 是局部二态模式：启用时保存原草稿、用 HEAD 完整 message 填入输入框，并把 commit 按钮语义改为“修订上次提交”；取消时恢复进入前草稿。
- 撤销成功后用 bridge 返回的原 message 更新当前 repository context 的提交草稿。
- 无 HEAD、detached HEAD 或 Git 写操作进行中时禁用对应动作并提供 tooltip。

## Bridge Contracts

新增：

```ts
amendGitCommit(projectPath: string, message: string): Promise<ProjectGitActionResult>;
undoLastGitCommit(
  projectPath: string,
  options?: { allowMerge?: boolean },
): Promise<ProjectGitActionResult>;
```

`ProjectGitActionResult` 增加可选 `commitMessage`，`ProjectGitActionBlockReason` 增加 `merge-commit`；根提交回滚失败使用普通失败结果报告真实错误。

## Amend Flow

1. Renderer 从 snapshot HEAD commit 取得完整 message 作为编辑初值。
2. Preload 再次验证 attached HEAD、非空 message，并读取 HEAD 完整 message 与 staged diff。
3. staged diff 为空且 message 未变化时返回 no-op failure；否则运行：

```bash
git commit --amend -m <message>
```

4. Store 通过 `runAuthorizedGitWrite` 使用 full refresh、`refs: true`。
5. UI 在实际写入前用 `ProjectActionDialog` 说明 amend 会重写 HEAD；取消不改变草稿或仓库。

不增加 author/date/sign/no-verify 选项。

## Undo Last Commit Flow

Preload 先读取 HEAD full hash、full message 和完整父列表，并验证 attached branch。

- 一个父提交：`git reset --soft HEAD~`。
- 多个父提交：未传 `allowMerge` 时返回 `merge-commit`；确认后同样 soft reset 到第一父提交。
- 根提交：删除 `HEAD` 后清空 index，使文件保留在工作区并变为未暂存/未跟踪状态。实现使用 argv 形式的 `update-ref -d HEAD` 与只影响 index 的 `rm --cached -r -f -- .`。

根提交路径在第二步失败时尝试用捕获的旧 hash 恢复 `HEAD` 和 index；恢复失败返回普通失败结果并保留真实错误，不得声称撤销成功。

成功结果携带被撤销提交的 `commitMessage` 与 hash；Store full refresh 后组件恢复草稿。该操作不创建 revert commit。

## State And Context

- 两个 Store action 都重新授权当前 repository target，并使用 full refresh + ref invalidation。
- amend mode、More 菜单和 pre-amend draft 保持组件局部；repository context 改变、面板关闭或卸载时清理。
- 可见提交草稿仍由 `GitTab.vue` 的 context-keyed draft 机制拥有，子组件只 emit 更新。

## Testing

- `scripts/validate-git-commits.mjs`：message-only amend、staged-content amend、空操作拒绝、普通/merge/root undo、草稿 message、detached 拒绝及根提交回滚保护。
- `tests/projectBridge.workspace.test.ts`：main/worktree/submodule target 路由、full/ref refresh、stale target 拒绝。
- 手动：More 菜单键盘/Escape、amend 草稿恢复、确认取消、窄窗口和 repository 切换。
