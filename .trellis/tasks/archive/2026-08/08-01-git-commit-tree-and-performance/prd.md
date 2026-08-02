# 优化 Git 提交树与交互性能

## Goal

让项目详情中的 Git 提交树在复杂分叉、领先和合并历史中准确呈现拓扑关系，并像 VS Code Source Control Graph 一样让每条提交信息贴近该行实际图形宽度；同时改进 ref 徽标、连续 hover preview、常用 Git 写操作和提交历史加载性能，并降低 Git 页单文件承担的职责。

用户价值：用户可以可靠地沿提交节点阅读分支关系，连续检查提交详情，并在暂存、取消暂存和加载历史时获得接近原生工具的即时反馈。

## Background

- 用户提供的对照图显示：同一段历史在 VS Code 中存在三条并行泳道，本项目只绘制两条；本项目所有提交文本还会被全局最大图形列宽统一推远。
- `src/components/project/GitTab.vue:3376-3679` 使用一组全局 `activeLanes` 计算整页 SVG，并以全局 `graphColumnWidth` 作为每一行的第一列宽度。父提交不在当前可见提交集合时，当前实现直接跳过对应边。
- `src/components/project/GitTab.vue:3261-3374` 同时负责 ref 解析、排序和徽标展示；`src/components/project/GitTab.vue:2554-3151` 同时负责 hover preview 的请求、缓存、计时、定位和生命周期。
- `src/store/useStore.ts:2320-2780` 已将完整快照、状态快照和提交分页拆开，但暂存/取消暂存后仍等待状态快照与 workspace 快照；性能瓶颈需要以命令次数和耗时基线验证，不能仅凭体感继续增加缓存。
- `public/preload.js:4537-4930` 的状态快照并行执行多条 Git 命令，还会同步递归读取未跟踪目录；提交分页会同时运行 `git log` 和完整 ref 枚举。
- 本地 `references/vscode` 包含 MIT 许可的 VS Code 工作台和内置 Git 扩展源码。可直接参考 `src/vs/workbench/contrib/scm/browser/scmHistory.ts` 的 input/output swimlane 模型、`scmHistoryViewPane.ts` 的按行图形宽度和徽标分组，以及 `extensions/git/src/historyProvider.ts` 的 refs/history/hover 数据边界。
- 不适合直接移植 VS Code 的 Tree、Observable、Theme、Command 和扩展宿主基础设施；本项目应保留 Vue、Pinia、preload bridge 和现有设计 token，只复用可独立验证的算法与交互原则。
- 已归档任务曾分别处理连续轨道、多分支裁切、ref 层级、轻量状态刷新和 hover preview，但没有留下独立图布局测试入口或统一性能基线。

## Requirements

### R1. 提交图拓扑正确性

- 图布局必须基于每条提交进入和离开该行的泳道状态表达分叉、直行、收束和多父提交，不能仅以“尚未出现的父提交 hash”作为全局占道状态。
- 当 feature 分支领先于 main、main 又新增提交并发生合并时，应保留三条同时存在的泳道，直到真实拓扑允许收束；不得因为某个父提交位于分页边界之外而提前删除仍贯穿可见区的轨道。
- 当前 HEAD、第一父链和非第一父链必须落在稳定且可追踪的轨道上；节点、连接线和对应提交行持续对齐。
- 筛选、分页追加和展开提交文件后，不得生成跨越隐藏提交的虚假连接，也不得让现有节点或路径错位。
- 图布局逻辑应成为可独立输入提交 fixture、输出行泳道与路径语义的纯逻辑模块，避免继续只能通过完整 Vue 组件目测验证。

### R2. 按行紧凑布局

- 每条提交的信息起点由该行实际 input/output 泳道数量决定，不再由整页历史中的最大 lane 数统一决定。
- 提交标题与该行最右侧有效节点或轨道保持紧凑间距；单轨行应明显贴近节点，多轨行只为仍需穿过该行的轨道预留空间。
- 在进一步缩短节点与文字距离后，分支线、节点、标题、作者、时间和 ref 徽标仍不得重叠。
- 保持现有紧凑行高、横向滚动、选择、展开文件、右键菜单和 hover preview 触发范围。

### R3. VS Code 风格 ref 徽标

- ref 使用结构化 id/kind/name/revision 语义排序，至少区分当前 HEAD、本地分支、远程分支和 tag。
- 徽标顺序优先表达当前 ref、对应 upstream/remote、其他有图形颜色的 ref，再显示普通 ref；不得依赖 refs 文本的偶然顺序。
- 同颜色、同图标类别的多个 ref 使用紧凑分组和数量表达；最重要的有色 ref 可显示名称，其余保留图标、数量和完整 hover 文本，避免重复长徽标挤压提交标题。
- 提交行与 hover preview 使用一致的 ref 语义、颜色和名称，不把 `remote/HEAD` 误判为当前 HEAD。
- 视觉上参考 VS Code 的紧凑胶囊徽标，但继续使用本项目 Lucide 图标、语义 token、浅色/深色主题和可访问名称。

### R4. 可测量的 Git 交互性能

- 在优化前记录代表性仓库上的命令次数、总耗时和关键阶段耗时，覆盖首次提交历史加载、连续切换 hover preview、单文件暂存和单文件取消暂存。
- hover preview 首次打开后，在已加载提交之间移动应立即更新基础内容；同一仓库上下文中同一 hash 的详情不得重复发起等价请求，旧请求不得覆盖当前提交。
- 暂存/取消暂存成功后优先更新必要的工作区状态，不因该操作重读提交历史、refs 或其他无关数据；需要保留写操作后的正确性校验和并发防串线。
- 首次提交历史和分页只执行生成当前 UI 所需数据的 Git/文件系统工作；避免每页重复获取可按仓库上下文复用的 ref 数据。
- 仅在基线证明 DOM 数量是主要瓶颈时再引入虚拟列表；本任务不预先增加新的缓存框架、Git 库或虚拟滚动依赖。

### R5. Git 页职责拆分与样式统一

- 将 `GitTab.vue` 中可独立测试或复用的图布局、ref 展示、hover preview 状态和 Git 工作区子视图按现有 Vue 模式拆分；不得为了降低行数制造只有单一调用者的空壳抽象。
- 拆分后 Git 页现有仓库选择、变更分组、提交输入、diff 审阅、AI、提交树、右键菜单和远程操作行为保持可用。
- 按 VS Code Source Control 的密度和层级校正 Git 区域按钮、文本框和折叠栏，但保留本项目整体视觉语言，不追求像素级复刻。
- 图标按钮使用现有 Lucide 图标、tooltip 和无障碍标签；文本框、折叠标题、hover/active/disabled 状态在浅色与深色主题下保持一致。

## Acceptance Criteria

- [ ] AC1: 三轨回归 fixture（feature 领先、main 新增并发生 merge）输出三条并行泳道，且分叉、直行和收束发生在正确提交行。（R1）
- [ ] AC2: 普通分叉、八爪 merge、分页边界、筛选列表和展开提交文件均有自动化图布局断言；节点与提交行无错位或伪造跨页连线。（R1）
- [ ] AC3: 单轨提交文字比当前实现更接近节点；多轨提交只按该行有效泳道增加缩进，截图对照中不再出现整列统一大空白。（R2）
- [ ] AC4: 当前 HEAD、本地、远程和 tag 徽标的顺序、分组、名称与 hover 文本稳定；多 ref 提交不挤掉主要提交标题，提交行与 preview 一致。（R3）
- [ ] AC5: 性能报告记录优化前后同一 fixture/仓库的命令次数与耗时；四个目标流程均无无关全量刷新或重复详情请求，并较基线有可说明的改善。（R4）
- [ ] AC6: 连续浏览已加载提交时 preview 无重新等待和明显空白闪烁；快速跨行、滚动、切换仓库时无旧内容串入。（R4）
- [ ] AC7: 暂存/取消暂存后 staged/unstaged 状态正确更新，提交历史和 ref 数据不被无关重读；分页追加保持现有滚动位置和已加载内容。（R4）
- [ ] AC8: `GitTab.vue` 不再直接承担图算法和全部 hover/ref 子系统；拆分边界有行为或类型检查保护，且不新增仅为转发的层级。（R5）
- [ ] AC9: Git 区域按钮、文本框、折叠栏和徽标在常规宽度、最窄允许左栏、浅色与深色主题下无重叠、裁切或不可达操作。（R2、R3、R5）
- [ ] AC10: 相关单元测试、`npm run type-check`、`npm run build` 和 Trellis 全量质量检查通过。（R1-R5）

## Task Map And Order

- `08-01-git-graph-layout-and-refs`：提交图正确性、按行紧凑布局和 ref 徽标。先建立纯图布局 helper 与回归 fixtures，再替换当前 Vue 内联算法。
- `08-01-git-interaction-performance`：Git 交互性能基线与优化。在子任务 1 的图数据边界稳定后，以命令追踪和耗时证据决定 preload/store/preview 的最小改动。
- `08-01-git-tab-refactor-and-styles`：`GitTab.vue` 职责拆分与 Git 控件样式统一。在前两个子任务行为稳定后拆分，避免一边移动代码一边改变算法或异步状态。
- 父任务不直接实施产品代码；三个子任务按上述顺序独立规划、启动、验证和归档，最后由父任务执行跨子任务集成验收。

## Key Decision

- 用户选择连续完成整个父任务，并接受拆为三个顺序子任务；不把性能与 `GitTab.vue` 拆分延期到未定义的后续迭代。

## Out of Scope

- 完整复制 VS Code Source Control Graph、扩展宿主、命令系统、Tree/Observable/Theme 服务或设置项。
- 引入第三方 Git 图、浮层、缓存或虚拟列表依赖，除非性能基线明确证明现有原生机制无法满足目标并重新经过规划确认。
- 改变 Git 写操作语义、远程协议、AI 提示词或提交详情数据内容。
- 追求与 VS Code 像素级一致，或在没有基线证据时进行全仓库 Git 架构重写。
