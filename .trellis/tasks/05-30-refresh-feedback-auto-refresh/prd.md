# 刷新按钮反馈与自动刷新评估

## Goal

为首页和项目详情页的刷新按钮增加刷新中的可见反馈，避免刷新耗时较长时用户不知道操作是否生效；同时明确后台自动刷新暂不纳入本次实现。

## What I Already Know

- 首页刷新按钮位于 `src/components/dashboard/Dashboard.vue`，当前点击后直接调用 `store.refreshProjects()`，没有等待状态、禁用状态或旋转反馈。
- 项目详情页刷新按钮位于 `src/components/project/ProjectDetails.vue`，当前只在项目可用时调用 `store.refreshGitSnapshot(project.id)`，没有等待状态。
- `store.refreshProjects()` 会先刷新所有项目路径可用性，再并行刷新可用项目的 Git 快照。
- `store.refreshGitSnapshot(projectId)` 会读取单项目 Git 快照并持久化项目数据。
- 现有环境检测和 AI 模型刷新已经使用 `RefreshCw` 图标 `animate-spin` 表达刷新中状态，可复用这一交互模式。
- 项目是前端主导的 Vue/Pinia 应用，当前状态集中在 `src/store/useStore.ts` 和组件中。

## Assumptions

- 首页刷新中应避免重复触发并给按钮本身提供旋转/禁用反馈。
- 项目详情页刷新中只锁定当前项目的刷新按钮，不影响打开终端、打开编辑器等其他操作。
- 自动刷新暂不纳入本次实现；后续如果加入，应默认关闭，并放在设置中由用户启用和设置间隔，避免默认后台 Git 调用带来性能、磁盘和电量开销。

## Requirements

- 首页刷新按钮在 `refreshProjects()` 执行期间显示刷新中状态。
- 项目详情页刷新按钮在当前项目 Git 快照刷新期间显示刷新中状态。
- 刷新中状态应至少包含旋转图标和可访问的标题/aria 文案变化。
- 刷新中应阻止同一个刷新入口重复点击，避免并发重复刷新。
- 自动刷新本次不实现，仅记录后续建议方案。

## Acceptance Criteria

- [ ] 首页点击刷新后，刷新按钮图标旋转，按钮在完成前不可重复触发。
- [ ] 项目详情页点击刷新后，当前项目刷新按钮图标旋转，按钮在完成前不可重复触发。
- [ ] 不可访问项目仍保持刷新按钮禁用逻辑。
- [ ] 刷新状态在成功或失败后都会复位。
- [ ] 自动刷新明确不纳入本次实现，并记录后续建议方案。
- [ ] lint/typecheck 通过。

## Recommendation

建议将自动刷新做成可选能力，而不是默认后台自动刷新。原因：这个刷新会触发文件系统路径检查和 Git 状态读取，项目数量多或仓库大时可能明显耗时；默认自动刷新可能带来不可预期的性能和电量消耗。更稳妥的 MVP 是先完成手动刷新反馈。如果现在纳入自动刷新，应默认关闭，提供 1/5/10/30 分钟等间隔选项，并且只在插件可见、无正在刷新任务时触发。

## Decision (ADR-lite)

**Context**: 首页和项目详情页刷新可能耗时较长，需要先解决手动刷新无反馈的问题；后台自动刷新会周期性触发路径检查和 Git 快照读取，存在性能、磁盘和电量开销。

**Decision**: 本次只实现刷新中反馈。后台自动刷新暂不实现，作为后续增强保留。

**Consequences**: 用户能立即知道手动刷新正在执行，且不会引入新的后台刷新行为。后续若实现自动刷新，应默认关闭、可配置间隔，并避免刷新任务并发。

## Definition of Done

- 代码风格与现有 Vue/Pinia 写法一致。
- 只改动与刷新状态/配置直接相关的前端代码。
- lint/typecheck 通过。
- 如产生新的约定或坑点，评估是否更新 `.trellis/spec/`。

## Out of Scope

- 不改变 Git 快照读取逻辑本身。
- 不新增进度百分比或逐项目进度条，除非后续确认需要。
- 不引入新的后台进程或原生侧定时器。
- 不实现后台自动刷新和刷新间隔设置。

## Technical Notes

- 相关文件：`src/components/dashboard/Dashboard.vue`、`src/components/project/ProjectDetails.vue`、`src/store/useStore.ts`、可能的设置入口 `src/components/layout/SettingsTab.vue`、`src/lib/projectBridge.ts`、`src/types.ts`、`src/lib/i18n.ts`。
- 现有刷新中交互参考：`src/components/environment/EnvironmentTab.vue`、`src/components/layout/SettingsTab.vue` 的 `RefreshCw` + `animate-spin`。
