# 实现详情页命令状态展示与紧凑布局

## Goal

改造项目详情页，使其更适合高频查看和操作：减少多余 card、圆角大块和空白占用；同时让同一项目内多条命令（例如前端和后端）在详情页中能清楚查看各自运行状态与输出日志。

## What I already know

- 用户明确要求详情页 UI 改为更紧凑高效，避免多余 card 设计和大量空白。
- 现有项目已经支持同一项目内容执行多个前端/后端命令。
- 当前详情页只能看到项目级聚合日志，无法同时区分多个命令的执行情况。
- `public/preload.js` 发出的运行事件已经包含 `projectId`、`scriptId`、`pid`、事件类型和输出内容。
- `src/store/useStore.ts` 当前 `logs` 只按 `projectId` 聚合，`handleBridgeEvent` 没有把日志关联回脚本维度。
- `src/components/terminal/Terminal.vue` 当前只接收 `projectId`，展示单条项目级日志流。
- `src/components/project/ProjectDetails.vue` 当前详情页外层和概览存在较多 card、空白和分散信息。
- `src/components/project/ScriptsTab.vue` 当前脚本列表与右侧状态/env 面板占用空间较多。

## Assumptions

- 最佳方案采用详情页“启动脚本”内的命令输出标签：只展示已经运行并产生日志的脚本，不展示“全部”日志标签，避免噪声。
- 保留项目级聚合日志仅作为内部兼容数据；用户界面以脚本级日志为主。
- 详情页不引入新依赖，继续使用 Vue、Pinia、Tailwind 和 lucide-vue-next。
- 不改变后端进程执行协议，只利用已有 `scriptId` 事件字段。

## Requirements

- 详情页顶部布局更紧凑，减少大间距和不必要的嵌套 card。
- 脚本页应以紧凑列表形式展示所有命令，包含名称、状态、命令、cwd、启动/停止操作。
- 运行日志应能按单个已运行脚本切换查看，不提供“全部”聚合标签。
- 运行日志只在“启动脚本”页展示，概览、Git、备忘页不重复展示。
- 运行日志需要清洗 ANSI 控制码，避免 Vite 等工具输出颜色码时在 UI 中显示乱码。
- Windows 下子进程输出可能是 GBK/GB18030，日志桥接层需要在 UTF-8 解码失败时兜底，避免中文输出乱码。
- 运行日志标签只展示运行过的脚本，并允许用户手动关闭当前会话里的日志标签；后续新输出可重新出现。
- 启动脚本页去除重复的“手动配置”、package.json 读取说明和大块嵌套 card。
- 启动脚本命令列表需要更紧凑，一行内展示命令名、状态、命令、cwd 和操作，避免名称被过早省略。
- Git 页去除大块统计 card，改为紧凑工作区变更列表和提交树；提交数据从最近 5 条扩展为全部分支的树形快照。
- Git 顶部标题不展示会让人误以为是统计值的文案或数字，树区应优先呈现分支走向而不是列对齐。
- 每个脚本标签/入口应显示运行状态，用户可以识别前端、后端等不同命令当前情况。
- stdout、stderr、exit、error、started 等桥接事件应记录到对应脚本日志，同时保留项目聚合日志。
- 清空日志时应支持清空项目下所有日志，避免残留旧脚本日志。
- 对路径不可用或命令为空的场景继续禁用启动操作。
- 中英文文案保持一致补齐。

## Acceptance Criteria

- [ ] 在详情页启动两条命令后，用户可以分别查看两条命令的输出情况。
- [ ] 终端区域只展示运行过的脚本日志标签，切换后日志内容正确过滤。
- [ ] stdout/stderr 中的 ANSI 控制码不会直接显示在运行日志中。
- [ ] 运行日志只出现在“启动脚本”tab。
- [ ] 启动脚本列表无重复“手动配置”说明，并且命令名称、命令、cwd 能在一行内高效展示。
- [ ] Git tab 能展示工作区变更和全部分支提交树，不再只显示最近几条提交的大卡片列表，且树形结构足够直观，不像表格。
- [ ] 详情页脚本列表和终端区域在常见桌面宽度下减少纵向空白，不需要先滚动大量 card 才看到日志。
- [ ] 命令退出、报错、用户停止后，对应脚本状态和日志能更新。
- [ ] 项目级状态仍能根据脚本状态派生为 RUNNING / ERROR / STOPPED。
- [ ] `npm run lint` 和 `npm run build` 通过。

## Definition of Done

- 代码符合现有 Vue/Pinia/Tailwind 风格。
- 不引入额外运行时依赖。
- 类型检查通过。
- 构建通过。
- 如发现可沉淀的约定，更新 Trellis spec。

## Out of Scope

- 不新增脚本分组字段或持久化 schema 变更。
- 不实现真正的同时并排多终端窗格拖拽布局。
- 不新增外部终端集成能力。
- 不重做仪表盘卡片或项目新增表单。

## Technical Notes

- 关键文件：`src/components/project/ProjectDetails.vue`、`src/components/project/ScriptsTab.vue`、`src/components/terminal/Terminal.vue`、`src/store/useStore.ts`、`src/types.ts`、`src/lib/i18n.ts`。
- 后端桥接层 `public/preload.js` 已具备脚本级事件标识，无需协议扩展。
- 决策：采用“全部 + 脚本标签”的单终端视图，而不是并排多个终端，以减少空间占用并保持移动/窄屏可用。
