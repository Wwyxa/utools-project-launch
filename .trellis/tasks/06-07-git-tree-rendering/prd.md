# 改进 Git 树渲染

## Goal

把项目详情里的 Git 提交树改成更接近 Git Graph 的连续轨道视图，让分支、合并、主线延续关系在滚动列表中更连贯、更流畅、更便于扫读。

## What I already know

- 用户对当前提交树渲染不满意：当前效果看起来线段断裂、局部、难以沿着分支路径阅读。
- 用户提供了 Git Graph 的视觉参考，并指出参考仓库为 `https://github.com/mhutchie/vscode-git-graph`。
- 用户反馈第一轮连续 SVG 改进后整体更好，但多分支时长曲线交叉仍显得乱，分页加载边界也会让未加载历史看起来像被继续渲染。
- 用户再次反馈：与 Git Graph 参考相比，当前实现仍然太像“边线网”，应更接近主干优先、分支泳道清晰展开/收回的视觉结构。
- 当前项目是 Vite + Vue 3 前端，Git 视图在 `src/components/project/GitTab.vue`。
- Git 提交数据已经包含 `hash`、`parents`、`refs`、`message`、`author`、`date`，可在前端重建 lane 关系。
- `public/preload.js` 通过 `git log --all --decorate=short` 获取提交列表，单次默认 80 条，支持加载更多。
- 仓库记忆要求 Git history rows 保持紧凑，即使显示作者和时间元信息。

## Assumptions

- 本次先优化当前提交列表的 Git tree 渲染，不引入完整 Git Graph 交互体系。
- 不复制 Git Graph 源码，只借鉴其“先计算轨道/点位，再渲染连续 SVG 路径”的设计思路。
- 现有提交筛选、选择、提交详情、加载更多、AI 分析入口都应继续工作。

## Requirements

- 将提交树从逐行局部线段感，改为连续、稳定的 lane/branch 轨道视觉。
- 分支线应跨行连续，合并/分叉连接应使用平滑或清晰的连接路径，减少视觉断裂。
- 多分支连接应避免跨多行的长斜线；跨 lane 时优先用短弯切换 lane，再沿垂直轨道延续。
- 主分支应优先保持稳定的左侧垂直轨道；merge 的非第一父分支在 merge 附近向右扇出，分支回到共同祖先时在目标提交附近扇入，避免在中间区域互相穿插。
- 分页加载时只渲染已加载提交窗口内的真实节点和连接；隐藏或未加载父提交不能被画成继续延伸的历史。
- 提交节点仍然准确落在对应提交行，HEAD 节点保持明显标识。
- 图形列宽应随 lane 数量响应，但保持行高紧凑，不挤压提交信息。
- 筛选后的列表、加载更多后的列表都不能产生明显错位或运行时错误。
- 不引入新依赖，优先在现有 Vue + SVG + Tailwind 风格内实现。

## Acceptance Criteria

- [ ] Git 提交树在复杂分支/合并历史中显示连续轨道，视觉上接近参考图的连贯流程。
- [ ] 分支、合并、主线延续在相邻行之间可跟踪，不出现明显断线或错位。
- [ ] 多分支历史中连接线收束清楚，不出现大面积长斜线交叉。
- [ ] 当 `hasMoreCommits` 为 true 时，图形不会越过已加载行区域继续渲染到“加载更多”区域。
- [ ] 提交行保持紧凑，作者/时间/refs/选择状态仍可正常显示。
- [ ] 点击提交、勾选提交、复制 hash、悬浮 tooltip、加载更多等现有交互可用。
- [ ] `npm run lint` / `npm run type-check` 通过。

## Definition of Done

- Implementation is scoped to Git tree rendering and any directly needed helper logic.
- Frontend specs are followed.
- Quality check agent reviews the change and fixes findings.
- Spec update judgment is completed before final wrap-up.

## Out of Scope

- 完整复刻 Git Graph 扩展功能。
- 新增右键菜单、分支操作、tag 操作、stash 操作等 Git Graph 交互。
- 改造 `git log` 数据格式，除非前端无法满足渲染需求。
- 引入第三方图形库。

## Technical Notes

- Existing impacted component: `src/components/project/GitTab.vue`.
- Existing data source: `public/preload.js` returns commit parents and refs.
- Research summary is saved in `research/vscode-git-graph-rendering.md`.
