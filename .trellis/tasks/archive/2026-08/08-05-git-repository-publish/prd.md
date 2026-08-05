# 初始化与发布 Git 仓库

## Goal

让用户可以在项目目录尚未初始化 Git 时直接创建仓库，并在当前本地分支尚无 upstream 时完成首次发布，打通进入版本控制和首次推送两条基础路径。

## Background

- 当前页面在没有 Git snapshot 时只显示“未检测到 Git 仓库”，没有初始化入口。
- 当前 fetch/pull/push 都依赖 upstream；已有 remote 但当前分支没有 upstream 时，三个操作都会被阻止。
- 当前 snapshot 已提供分支、detached HEAD、remote 和 upstream 信息，现有 remote 写操作已经具备非交互认证、超时、反馈和刷新机制。

## Requirements

- R1：未检测到 Git 仓库时提供“初始化 Git 仓库”操作，执行原生 `git init`，遵循用户现有 Git 默认分支配置，不增加分支命名向导。
- R2：初始化成功后刷新仓库信息，使 Git 页面直接进入新仓库状态；失败时保留原状态并显示 Git 返回的错误。
- R3：当前 HEAD 指向本地分支、至少配置一个 remote 且没有 upstream 时，提供“发布当前分支”操作。
- R4：只有一个 remote 时直接使用该 remote 进入确认；存在多个 remote 时要求用户选择目标 remote。
- R5：发布使用当前本地分支名作为远程分支名，并建立 tracking upstream；不提供任意 refspec 或独立远程分支名输入。
- R6：detached HEAD、无 remote、已有 upstream 或仓库不可用时不允许发布，并给出可理解的原因。
- R7：初始化只作用于项目目录；发布作用于当前选中的可用仓库上下文。

## Acceptance Criteria

- [ ] 非 Git 项目可以成功初始化，并在刷新后显示当前分支、工作区和提交状态。
- [ ] Git 不可用、目录不可写或初始化命令失败时显示错误且不伪造成功状态。
- [ ] 无 upstream 且只有一个 remote 的本地分支可以经确认后发布，并在成功后显示新 upstream。
- [ ] 多 remote 仓库发布前可以选择目标 remote，命令不会发送到未选中的 remote。
- [ ] detached HEAD、无 remote 和已有 upstream 状态不会出现可执行的错误发布入口。
- [ ] 远程认证失败或超时时显示现有风格的错误，仓库状态会重新读取。

## Out of Scope

- 修改已有 upstream、设置不同的远程分支名、force push 和删除远程分支。
- 初始化时选择 bare、模板目录、对象格式或初始分支名称。
