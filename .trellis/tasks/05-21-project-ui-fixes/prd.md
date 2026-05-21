# 修复项目树截断、停止卡顿和 running 条形显示

## Goal

修复项目详情里的 Git 树在窄宽度下被右侧遮挡的问题，减轻主界面停止运行中命令时的卡顿感，并修正项目卡片在 running 状态下左侧绿色竖条在部分屏幕上的间距异常。

## What I already know

- 用户反馈有 3 个可见问题，且都集中在主界面和项目卡片/项目详情页。
- 截图显示项目详情页的 Git 视图里，提交树列表右侧内容有被容器裁掉的风险。
- 截图显示项目卡片在 running 状态时，左侧绿色状态条在某些宽度下没有贴齐边框。
- 项目停止命令的卡顿发生在主界面停止运行中的命令时，可能与停止流程中的同步状态更新或刷新有关。

## Assumptions (temporary)

- 这三个问题都可以通过前端布局和状态流调整解决，不需要改底层数据模型。
- Git 树被遮挡更像是容器布局/滚动区域问题，而不是数据缺失。
- 停止卡顿更可能来自阻塞式 UI 更新、等待命令结束回调或过重的同步刷新。

## Open Questions

- none yet

## Requirements (evolving)

- Git 视图在窄宽度下应保留完整内容可见性，至少支持横向/纵向滚动或改为不截断布局。
- 主界面停止运行中命令时，UI 响应应尽量即时，避免明显“卡一下”。
- 项目卡片 running 状态的左侧绿色条应始终贴合卡片左边缘，不随屏幕宽度产生缝隙。

## Acceptance Criteria (evolving)

- [ ] Git 树列表在窄宽度下不再右侧被裁掉，用户可以看到完整条目或通过滚动查看。
- [ ] 停止运行中的命令时，主界面没有明显卡顿感。
- [ ] project card 的 running 状态绿色竖条在常见屏幕宽度下始终贴边显示。

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- 不重做整体视觉风格。
- 不修改与这三个问题无关的业务逻辑。

## Technical Notes

- 需要检查 `src/components/project/GitTab.vue`、`src/components/dashboard/ProjectCard.vue` 以及停止命令相关的主界面/终端状态流代码。
- 重点关注容器宽度、overflow、flex/grid 约束，以及停止命令时是否存在同步刷新或整页重算。
