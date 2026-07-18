# 优化 Git 树多分支渲染

## Goal

让项目详情中的 Git 提交树在多本地分支、远程跟踪分支、分支切换和分支已落后于当前 HEAD 的历史中，持续清晰地呈现拓扑关系与引用归属；ref 徽标的层级和色彩参考用户提供的 VS Code Git 图效果。

## Confirmed Facts

- Git 图由 `src/components/project/GitTab.vue` 中基于提交父级关系的 Vue computed layout 绘制为连续 SVG 轨道。
- 提交数据来自 `public/preload.js` 的 `git log --all --topo-order --decorate=short`，包含提交 hash、父提交和 decorate refs，因此能在本地识别引用所在的历史提交。
- 当前检出的分支会优先进入最左图形轨道；切换分支后，Git 快照会重新读取并更新 `branch` 与 `branches`。
- 当前分支的 upstream、ahead 和 behind 已被采集；其他本地分支只提供 `name` 与 `current`，ref 徽标也仅按 tag、HEAD、remote、main/master 和默认样式粗分。
- 当前仓库实际包含 `HEAD -> master`、旧提交上的 `remote/master, remote/HEAD` 和本地 `tiny-card` 分支。现有 `refs?.includes("HEAD")` 会将 `remote/HEAD` 误判为当前 HEAD。
- 既有 Git 树约定是：主线优先、轨道连续、分叉/合并在邻近提交处扇出或收束、避免跨多行长斜线，并在密集历史中允许横向滚动。

## Requirements

- R1: 在包含多个本地分支、远程分支、分叉和合并的提交历史中，保持轨道与节点对齐、可追踪，且不裁切或遮挡提交信息。
- R2: 每次切换到任意本地分支后，将该分支作为当前 HEAD 的视觉焦点并优先稳定在左侧轨道；之前的主分支及其他分支仍须以正确引用显示在其提交上。仅精确的 `HEAD` 或 `HEAD -> <branch>` 引用可触发当前 HEAD 节点样式，`remote/HEAD` 不得触发。
- R3: 为 ref 徽标建立清晰的视觉层级，至少区分当前 HEAD、本地主分支、本地非主分支、远程跟踪分支和 tag；普通本地分支不得继续使用无语义的默认灰色样式。徽标使用现有 Lucide 图标和语义设计 token，并在提交行与 tooltip 中保持一致。
- R4: 当本地或远程引用指向当前 HEAD 之前的提交时，保留其对应徽标和图形上下文，使用户可以一眼辨认该引用没有跟随当前分支最新提交。
- R4a: 本任务仅通过引用所在的提交位置和徽标层级表达“落后”状态，不为非当前分支采集或显示与当前 HEAD 或 upstream 的 ahead/behind 数量。
- R5: 保持提交筛选、加载更多、提交选择、tooltip、上下文菜单中的分支切换、提交文件展开、远程操作和现有窄窗口布局可用。
- R6: 不引入新的图形依赖，不复制第三方 Git Graph 代码；优先复用既有 Vue、SVG、Tailwind 和 preload bridge 边界。

## Acceptance Criteria

- [ ] AC1: 多分支/合并历史中的轨道连续，节点与提交行准确对齐，提交信息和 ref 徽标不重叠或被裁切。（R1）
- [ ] AC2: 切换到任意本地分支后，该分支的 HEAD 和最左优先轨道正确更新；主分支不会被误标为当前分支，`remote/HEAD` 也不会被绘制成当前 HEAD 节点。（R2）
- [ ] AC3: 当前 HEAD、本地主分支、本地非主分支、远程跟踪分支和 tag 具有可辨识且一致的图标化徽标样式；非主本地分支有明确样式，提交行与 tooltip 不漂移。（R3）
- [ ] AC4: 指向旧提交的本地或远程 ref 会显示在该提交处，并与当前分支的最新位置形成可读的视觉差异。（R4）
- [ ] AC4a: 非当前分支不会显示未经定义比较基准的 ahead/behind 数量；“落后”只由其所在提交位置和类型化徽标表达。（R4a）
- [ ] AC5: 既有 Git Tab 交互和横向滚动行为保持可用，筛选或分页不会生成跨越隐藏提交的误导性连线。（R1、R5）
- [ ] AC6: 相关前端检查通过，且无新增运行时或类型错误。（R6）

## Constraints

- 本任务聚焦提交树和 ref 徽标，不新增创建、删除、合并或重命名分支等 Git 写操作。
- 不要求完整复刻 VS Code Git Graph 的功能或交互，仅借鉴其信息层级和连续轨道表达。
- 不扩展非当前分支的 upstream 或 ahead/behind 数据契约；当前 bridge 中已有的当前分支同步状态继续保持原样。
