# 拆分 GitTab 并统一 Git 控件样式

## Goal

在提交图和性能行为稳定后，降低 `GitTab.vue` 的职责密度，并让 Git 区域按钮、文本框、折叠栏和徽标形成一致、紧凑、接近 VS Code Source Control 的交互层级。

## Background

- `GitTab.vue` 当前同时承担仓库上下文、变更列表、提交输入、图布局、refs、hover preview、提交文件树、右键菜单、AI 对话框、远程操作和模板渲染。
- 项目按 feature 组织组件，局部 UI 状态留在组件，共享仓库数据留在 Pinia；不鼓励为了移动代码建立单调用者的空 composable 或纯转发组件。
- 本任务依赖前两个子任务先固定图 helper、ref presentation、tooltip 缓存和性能关键路径，再拆分拥有明确 props/events 契约的子视图。

## Requirements

- R1: `GitTab.vue` 最终只保留 Git 页编排、共享仓库上下文和跨区交互协调，不再内联拥有图布局算法、ref 分类算法或完整 tooltip 请求/定位生命周期。
- R2: 纯数据逻辑进入 `src/lib` 并由单元测试保护；仅一个视图使用但拥有完整 UI 与生命周期的区域可成为 `src/components/project` 下的领域组件。
- R3: 子组件通过窄、显式、类型化的 props/events 交流；不得复制 Pinia 快照、仓库 context、写操作状态或 selection source of truth。
- R4: 不以行数为唯一目标，不创建只转发 store/action/class 的包装层；每个新增文件必须拥有可描述且独立变化的职责。
- R5: 保持仓库选择、变更折叠、stage/unstage、commit message、diff 审阅、提交树、文件展开、preview、上下文菜单、AI、远程操作和可调分栏行为。
- R6: 统一 Git 一级/二级折叠标题的高度、层级、计数、chevron 和右侧操作区；狭窄宽度下操作区可达且不产生负向不可滚动溢出。
- R7: 统一 icon button 的尺寸、hover/focus/active/disabled/loading 状态、Lucide 图标、tooltip 与 aria-label；清除只因历史迭代产生的同义 class 组合。
- R8: commit message、筛选和其他 Git 文本输入复用项目 `ui-field`/语义 token 规则，焦点、placeholder、滚动和深色主题可读性一致。
- R9: ref 徽标与提交行继续遵守子任务 1 的紧凑布局；不通过增大 card、圆角或额外说明文字模拟 VS Code。

## Acceptance Criteria

- [ ] AC1: `GitTab.vue` 不再包含图泳道计算、ref kind 推断和完整 tooltip 异步缓存/定位实现；这些职责具有命名明确的模块或组件与 focused tests。（R1、R2）
- [ ] AC2: 每个新增组件/模块有独立职责和窄契约；不存在仅转发全部 store、超大 props 对象或重复 snapshot 状态的空壳层。（R3、R4）
- [ ] AC3: Git 页全部现有业务流程与前两个子任务的图、徽标、preview、性能行为通过回归验证。（R5）
- [ ] AC4: 一级/二级折叠栏、icon buttons 和文本输入在常规与最窄左栏中层级一致、无重叠、无不可达首尾按钮。（R6-R8）
- [ ] AC5: 浅色、深色和 uTools host-like viewport 下，按钮、输入、徽标、metadata、focus 和 disabled 状态使用语义 token 且清晰可辨。（R6-R9）
- [ ] AC6: 没有新增运行时依赖、持久化 schema 或无必要 bridge API；重复 class/死状态/死 locale key 随迁移删除。（R4、R7、R8）
- [ ] AC7: focused Vitest、`npm run type-check`、`npm run build` 和桌面/窄屏浏览器回归通过。（R1-R9）

## Out Of Scope

- 重做 Git 页信息架构、替换现有左右分栏或删除用户当前可用功能。
- 建立通用组件库、设计系统包、全局状态框架或新的样式依赖。
- 为达到任意文件行数阈值拆分强耦合逻辑，或同步重构与 Git 无关的项目组件。
