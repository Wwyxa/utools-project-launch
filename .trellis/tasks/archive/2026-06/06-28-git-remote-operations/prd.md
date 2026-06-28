# Git 远程仓库操作

## Goal

在项目详情的 Git Tab 中增加远程仓库操作能力，让用户可以查看当前仓库的 remote/upstream 状态，并直接执行常用远程操作，而不必切到终端。

## Confirmed Facts

- 当前项目没有独立后端；Git 操作通过 `public/preload.js` 暴露到 `ProjectBridge`，再由 Pinia store 提供给 Vue 组件。
- Git Tab 已支持本地状态刷新、文件暂存/取消暂存/丢弃、提交、分支切换、提交历史筛选和 AI 分析。
- 现有 Git 写操作使用统一的操作反馈、确认弹窗和 mutation 后刷新模式。
- 远程仓库信息尚未进入 `ProjectGitSnapshot` / `ProjectGitStatusSnapshot` 类型。

## Requirements

- Git 快照需要展示当前仓库的远程状态：remote 列表、当前分支 upstream、ahead/behind，以及是否缺少 upstream。
- Git Tab 需要提供 fetch、pull、push 三个远程操作入口。
- fetch / pull / push 只操作当前分支的默认 upstream；pull 使用普通 merge；本轮不提供 force push、rebase pull、push -u。
- Git Tab 需要提供 remote 管理入口，支持 add、remove、set-url。
- remove remote 必须二次确认；remote name 和 url 必须做基础校验，避免空值和明显非法输入。
- 远程操作完成后需要刷新 Git 状态，失败时保留错误信息并不破坏现有本地 Git 功能。
- UI 需要沿用现有 Git Tab 的紧凑面板、图标按钮、全局操作反馈和确认弹窗风格。

## Acceptance Criteria

- [ ] 有 remote/upstream 的仓库能在 Git Tab 中看到 remote 名称、url、当前 upstream 和 ahead/behind 状态。
- [ ] 无 remote 或无 upstream 的仓库能看到明确的空状态/提示，fetch/pull/push 不会误执行。
- [ ] fetch、pull、push 调用 preload 中的 Git 命令，成功/失败都显示反馈，并在完成后刷新快照。
- [ ] add remote、set-url 能更新 remote 列表；remove remote 需要确认后执行。
- [ ] push 不提供 force 相关入口；pull 不提供 rebase 入口。
- [ ] 现有本地 Git 操作、提交历史、分支切换和 AI 分析不回归。
- [ ] `npm run build` 通过。

## Notes

- User confirmed scope: remote status + fetch/pull/push + remote add/remove/set-url management.
- User confirmed safety policy: current branch upstream only, normal pull merge, no force push.
