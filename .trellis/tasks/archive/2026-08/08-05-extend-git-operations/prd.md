# 扩展 Git 操作能力

## Goal

补齐项目 Git 页面中仓库初始化、首次发布、最近提交修正和历史提交应用等常用操作，让用户不必为这些高频动作切换到终端，同时保持功能边界简单、可恢复且不引入通用 Git 客户端复杂度。

## Background

- 当前 Git 页面已经支持工作区 diff、暂存/取消暂存/丢弃、普通提交、stash、分支与标签管理，以及基于既有 upstream 的 fetch/pull/push。
- 所有新操作应作用于当前选中的可用仓库上下文，包括主仓库、linked worktree 和已检出的 submodule；仅“初始化仓库”作用于尚未成为 Git 仓库的项目目录。
- VS Code 的 “Undo Last Commit” 使用 soft reset 回退 `HEAD~`，保留被撤销提交的文件改动并恢复提交信息；初始提交采用删除 `HEAD` 并取消暂存的特殊处理。它不会像 revert 那样创建反向提交。

## Requirements

- R1：子任务 `08-05-git-repository-publish` 提供初始化 Git 仓库和发布当前分支并建立 upstream 的能力。
- R2：子任务 `08-05-git-last-commit-correction` 提供 amend HEAD 和 VS Code 风格的撤销上次提交能力。
- R3：子任务 `08-05-git-history-actions` 提供单提交 cherry-pick 和单提交 revert 能力。
- R4：新操作复用现有 Git bridge、store 写操作协调、仓库刷新、全局反馈和危险操作确认机制。
- R5：不新增运行时依赖，不提供任意 Git 参数输入，不扩展为通用 Git 客户端。
- R6：每项操作必须有明确的可用条件、成功反馈、失败反馈和仓库状态刷新，不能静默失败或把界面留在过期状态。
- R7：cherry-pick/revert 冲突时自动 abort 并恢复操作前状态；插件不提供 continue/skip/冲突解决流程。
- R8：冲突或自动恢复失败时提示用户使用专业 Git 工具处理，并说明可在外部应用设置中完成配置后通过现有仓库菜单打开；提示本身不提供直接启动操作。

## Acceptance Criteria

- [ ] 用户可以在非 Git 项目、无 upstream 分支、最近提交和历史提交四类入口中发现对应操作。
- [ ] 六项操作分别满足所属子任务的验收标准。
- [ ] 主仓库、可用 linked worktree 和可用 submodule 上的新增操作遵循当前仓库选择，不误写其他仓库。
- [ ] 写操作并发锁定、反馈和刷新行为与现有 Git 操作一致。
- [ ] cherry-pick/revert 冲突后返回真实失败信息；自动恢复成功与失败均不伪造状态，并提示可配置并使用外部应用，但不从提示直接启动。
- [ ] 类型检查、构建、Git bridge 验证及相关测试通过。

## Out of Scope

- merge、rebase 及其 continue/skip/abort 工作流。
- soft/mixed/hard reset 的通用入口。
- 多提交 cherry-pick 或 revert。
- merge commit 的 cherry-pick/revert 主父提交选择。
- 按 hunk/行暂存、worktree 管理、submodule 生命周期管理和远程标签/分支删除。
