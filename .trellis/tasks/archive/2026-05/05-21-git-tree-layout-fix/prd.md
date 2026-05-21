# 优化 Git 树展示完整性

## Goal

修复项目详情页 Git 视图中提交树在窄宽度下展示不完整的问题，确保提交行、分支标签和图形节点不会因为容器布局而被截断或挤乱。

## What I already know

- 用户反馈 Git 树仍然展示不完整，截图里右侧列和图形区域都存在被裁切或错位的迹象。
- 之前的改动没有解决问题，说明根因更可能在 Git 视图本身的行布局、列宽、滚动容器或 SVG 宽度计算。
- 当前 Git 视图位于 `src/components/project/GitTab.vue`，使用单个滚动容器和自定义 graph row 计算。

## Assumptions (temporary)

- 问题主要出在 Git 历史行的布局策略，而不是数据缺失。
- 需要优先保证内容完整可见，其次才是视觉紧凑。
- 可能需要允许 Git 图区域横向滚动，或将行内容拆成更可压缩的布局。

## Open Questions

- none yet

## Requirements (evolving)

- Git 历史行在窄窗口下应保持完整可见，必要时允许横向滚动。
- 右侧的作者、时间和 ref 标签不应被容器边界裁掉。
- 图形列不能把后续文本列挤出可视区域。
- Git 图形列应根据实际 lane 宽度动态调整，避免单分支或少量分支仓库出现过大的空白图列。

## Acceptance Criteria (evolving)

- [ ] Git 提交树在窄宽度下不再出现右侧内容缺失或列错位。
- [ ] 在常见窗口宽度下，Git 图表和文本列都可完整阅读。
- [ ] 单分支或少量分支仓库的 Git 图列保持紧凑，不显得空旷。
- [ ] 构建和类型检查通过。

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- 不重做 Git 视图的整体视觉设计。
- 不改 Git 数据获取逻辑。

## Technical Notes

- 重点检查 `GitTab.vue` 中的 `graphRows` 计算、`grid-cols` 定义、容器 `min-width/overflow` 和 ref 标签的截断方式。
- 如果单行布局继续被挤压，考虑将内容转为双层布局或增加独立的横向滚动区域。
