# 去除侧边栏并调整设置入口

## Goal

简化当前应用壳层：去掉只承载项目/设置入口的左侧边栏，把设置入口迁移到右上角工具区，让项目列表获得完整横向空间，并减少重复导航层级。

## What I already know

* 当前侧边栏组件 `src/components/layout/Sidebar.vue` 只有项目入口和设置入口。
* 项目页是默认主视图，项目入口不提供额外信息架构价值。
* Dashboard 右上角已有刷新和新增项目按钮，适合容纳设置入口。
* `activeTab` 目前只有 `projects` 与 `settings` 两种全局页签状态。
* 进入项目详情时 `setSelectedProject` 会把全局页签切回 `projects`。

## Assumptions

* 侧边栏可以完全移除，不保留左侧品牌图标区。
* 设置入口放在 Dashboard 右上角工具区。
* 设置页需要提供返回项目页的入口，否则用户进入设置后无法回到项目列表。

## Requirements

* 移除应用左侧固定侧边栏和主内容区的左边距。
* 在右上角工具区新增设置入口。
* 在设置页提供回到项目页的入口，推荐沿用右上角区域的图标按钮。
* 项目卡片在移除侧边栏后进一步压缩宽度与内部留白，优先支持常规桌面宽度下展示三列。
* 调整项目卡片的信息层级：状态显示和工具按钮固定放在卡片顶部或底部操作区，避免右上悬浮替换造成空白和可发现性问题。
* 保持现有项目列表、刷新、新增项目、项目详情和设置能力不变。
* 保持视觉风格与现有工具栏按钮一致。

## Acceptance Criteria

* [ ] 应用主内容从窗口左侧开始布局，不再为侧边栏预留 64px。
* [ ] Dashboard 右上角可进入设置页。
* [ ] 设置页可返回项目列表。
* [ ] 不再渲染或引用 `Sidebar.vue`。
* [ ] 项目卡片更紧凑，状态与工具按钮在卡片内稳定可见，不依赖 hover 才出现。
* [ ] 项目网格在可用宽度增加后优先展示三列，且卡片文本不发生明显挤压或重叠。
* [ ] lint/type-check 通过。

## Definition of Done

* Lint / typecheck green.
* 视觉入口清晰，不增加新的导航层级。
* 如有必要，移除不再使用的组件文件。

## Out of Scope

* 不重做整体标题栏或 uTools 顶部容器。
* 不新增设置弹窗或路由系统。
* 不新增复杂的项目分组、排序或筛选规则。

## Technical Notes

* Likely files: `src/App.vue`, `src/components/dashboard/Dashboard.vue`, `src/components/dashboard/ProjectCard.vue`, `src/components/layout/SettingsTab.vue`, possibly remove `src/components/layout/Sidebar.vue`.
* Relevant frontend spec index: `.trellis/spec/frontend/index.md`.
