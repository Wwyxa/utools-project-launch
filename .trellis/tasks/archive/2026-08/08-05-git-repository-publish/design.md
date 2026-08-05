# 初始化与发布 Git 仓库 - Technical Design

## UI Ownership

`GitTab.vue` 继续拥有 repository context、顶部状态区、remote 菜单和全局 Git 反馈。

- 当主项目目录没有 Git snapshot 时，在顶部状态区显示紧凑的“初始化 Git 仓库”命令；不建立独立向导或卡片页面。
- push 图标在已有 upstream 时保持现有 push；无 upstream、HEAD 为本地分支且至少有一个 remote 时变为“发布当前分支”。
- 单 remote 直接进入确认；多 remote 复用现有 remote popover，在对应 remote 行提供发布动作。
- detached HEAD、无 remote、已有 upstream 或写操作进行中时不暴露可执行发布入口。

## Bridge Contracts

新增两项 `ProjectBridge` 方法：

```ts
initializeGitRepository(projectPath: string): Promise<ProjectGitActionResult>;
publishGitBranch(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>;
```

- Browser fallback 返回 typed unavailable result。
- Preload export 直接暴露两个实现，不建立通用 Git command API。

## Initialization Flow

1. Store 根据 `projectId` 读取主项目路径并确认项目存在且路径可用。
2. 因失败的 workspace inventory 可能使 main target 无法授权，初始化不调用 `runAuthorizedGitWrite`；它只复用 `gitWritesInProgress[projectId]` 计数与统一反馈调用方。
3. Preload 以 `git -C <projectPath> init` 初始化，遵循用户全局 `init.defaultBranch` 等原生配置。
4. 成功后 Store 清理该项目旧 Git coordination、workspace 和 snapshot 缓存，再强制读取 workspace 与主 snapshot。
5. 失败时不写入伪 snapshot，只返回 Git 错误。

初始化仅允许主项目目录，不接受 worktree/submodule target。

## Publish Flow

1. Store 通过 `runAuthorizedGitWrite` 重新授权当前 repository target。
2. Preload 验证 remote name、remote 是否存在、当前 HEAD 是否为本地分支以及当前分支是否尚无 upstream。
3. 使用现有远程执行约束异步运行：

```bash
git push --set-upstream <remote> HEAD:<current-branch>
```

4. 禁用 `GIT_TERMINAL_PROMPT`/GCM 交互并使用现有 remote timeout。
5. 成功或失败后 full refresh；成功结果携带 `remote` 和 `branch`。

不允许自定义 refspec、远程分支名或 force push。

## Validation Boundaries

- Renderer 只做按钮可用性预判；preload 再次验证所有 Git 状态。
- remote 参数保持 argv token，不进入 shell command。
- 发布属于 remote/ref mutation，Store 使用 `{ refresh: "full", refs: true, refreshOnFailure: true }`。

## Testing

- 在 `scripts/validate-git-commits.mjs` 中增加未初始化目录和本地 bare remote fixture，验证初始化、首次发布、upstream 建立和重复发布拒绝。
- 在 `tests/projectBridge.workspace.test.ts` 中验证 linked worktree/submodule 发布传递正确路径、stale target 不调用 bridge、初始化只使用项目主路径并重新读取状态。
- 手动验证单/多 remote 菜单、detached/无 remote 状态、认证失败和窄窗口布局。
