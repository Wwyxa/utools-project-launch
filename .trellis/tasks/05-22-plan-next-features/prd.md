# 规划插件后续功能

## Goal

在现有 uTools 本地项目启动器基础上，规划下一阶段功能增强。目标是在不破坏当前轻量、统一、可维护体验的前提下，把插件从“项目启动器”自然升级为面向本地开发的轻量工作台，并在取得确认后再进入实现。

## What I Already Know

- 当前插件已支持手动添加本地项目，配置路径、类型、启动命令、环境变量、备忘和待办。
- 当前插件支持 Node.js、Python、Go、可执行文件、自定义项目类型。
- 当前插件可启动/停止本地命令，并把输出回传到运行日志。
- 当前 Git 面板是只读状态展示，包含分支、ahead/behind、变更文件、diff、最近提交和提交树。
- 当前已有项目文件树与文件预览/编辑桥接能力。
- 当前已有打开项目目录、打开外部终端、打开编辑器、导入导出配置、主题与中英文界面。
- 用户要求先构思规划，征求同意后实施；代码规范要符合当前项目要求，样式要统一。
- 用户对“更丰富的 Git 查看与理解”感兴趣，但认为在插件中做 Git 提交、丢弃、切换等变动相关操作不太合适。
- 用户设想新增“环境查看”：在独立界面查看当前系统 Node、Python、Go 等开发环境，但不需要默认全部展示，应允许用户配置显示哪些软件环境信息。
- 用户设想新增“AI 接入”：参考 uTools 文档接入 `utools.ai` / `utools.allAiModels()`，同时提供第三方 API 接入，支持基本 Anthropic、OpenAI 格式接口；AI 具体应用场景待定。
- uTools 文档显示 preload 可使用 Node.js 原生能力，适合检测系统环境和执行受控本地命令。
- uTools 文档显示 `utools.registerTool(name, handler)` 可在 preload 或页面初始化阶段注册工具，工具需要与 `plugin.json > tools` 中定义的 key 一致，参数应严格匹配 `inputSchema`，长任务应提供进度反馈，返回值应结构化。
- uTools 文档显示 `utools.ai(option[, streamCallback])` 支持流式调用和 Function Calling；Function Calling 的函数需挂到 `window` 对象上。`utools.allAiModels()` 可获取可用 AI 模型。

## Product Direction Candidates

### A. Git 查看增强

在当前只读 Git 面板基础上，增强“看懂仓库变化”的能力。Git 功能继续保持只读边界，不做 commit、stage、discard、checkout、pull、push、reset 等会改变仓库或工作区的操作。

可能包含：

- 复制分支名、提交 hash、提交信息、文件路径。
- 打开仓库目录、在外部编辑器打开变更文件。
- 查看某个 commit 的详情、文件列表和 diff。
- 按时间范围、作者、关键词筛选 commits。
- 对比两个 commit / 分支引用之间的变更摘要。
- 按文件查看最近修改历史。
- 结合 AI 分析某几个 commit 做了什么、某段时间的 commit 做了什么、一次发布周期内的主要改动。

优点：符合用户兴趣，能复用现有 GitTab、preload git 命令和 diff 能力。

风险：commit 查询、diff 查询和 AI 分析可能带来较大输出，需要做好分页、截断和加载状态。

### B. 环境查看

新增独立“环境”界面，展示当前系统中用户选择关注的开发工具安装状态、版本、路径和基础可用性，帮助判断项目启动环境是否完整。

可能包含：

- 内置可选环境项：Node.js / npm / pnpm / yarn / Python / pip / Go / Git / Docker 等。
- 用户可配置启用哪些环境项；未启用项不在主环境页展示。
- 支持自定义环境项：名称、检测命令、版本参数或完整命令。
- 显示可执行文件路径、版本、检测时间、检测失败原因。
- 支持一键刷新。
- 可从项目详情跳转查看与项目类型相关的环境项。
- 后续可加入端口占用、PATH 检查、包管理器检测。

优点：与本地项目管理强相关，preload 中用 Node.js 原生能力即可完成，第一版风险较低。

风险：Windows 下命令输出编码、命令不存在、版本输出差异需要统一处理；自定义命令需要避免执行危险命令，第一版应只支持版本检测类命令。

### C. AI 接入与开发辅助

提供 AI 能力配置和调用层，支持 uTools 内置 AI 与第三方 OpenAI / Anthropic 兼容接口。先搭建能力底座，再选择具体应用场景。

可能包含：

- AI 设置页：提供商、模型、Base URL、API Key、是否使用 uTools 内置 AI。
- 模型列表：uTools 模式下读取 `utools.allAiModels()`；第三方模式手动填写模型。
- 统一消息调用层：支持非流式/流式输出，适配 OpenAI Chat Completions 与 Anthropic Messages 基本格式。
- 凭据存储：优先使用 uTools 本地存储，界面不回显完整密钥。
- 具体功能候选：解释 Git diff、总结某几个 commit、总结某段时间的 commit、生成变更摘要/发布说明草稿、根据运行日志分析启动失败原因、根据环境检测结果给出修复建议、整理项目备忘。

优点：能把现有 Git、日志、文件和环境信息串起来，形成更聪明的开发助手。

风险：AI 应用点需要先收敛，否则容易变成泛聊天；第三方 API 涉及密钥存储、网络错误、流式适配和不同协议差异。

## Recommended MVP

优先推荐分两步走：

1. 第一阶段实现“可配置环境查看 + Git 只读查看增强”。
2. 第二阶段接入 AI，并优先用于 commit / diff / 时间范围变更分析。

原因：环境查看风险低、基础价值稳定；Git 查看增强符合用户明确兴趣且不越过仓库安全边界；AI 最好建立在 Git/日志/环境这些可结构化上下文之上，避免先做一个泛聊天入口。

第一阶段建议 MVP：

- 新增“环境”独立界面或设置下的二级页，默认提供 Node、npm、pnpm、yarn、Python、pip、Go、Git、Docker 等可选项，但主界面只展示用户启用的环境项。
- 环境设置支持勾选显示项，后续可扩展自定义检测命令。
- Git 面板增加只读查看能力：复制分支/提交/路径、打开仓库目录、查看 commit 详情、按条件筛选 commit、查看指定 commit 的文件变更。
- 暂不加入 commit、stage、discard、pull、push、checkout、reset 等变动相关操作。

## Proposed Implementation Slices

### Slice 1: 可配置环境查看

- 新增一个环境入口，位置优先考虑 Dashboard 顶部工具栏或 Settings 内独立区域。
- 内置环境项配置：Node.js、npm、pnpm、yarn、Python、pip、Go、Git、Docker。
- 用户可以勾选主环境页展示哪些项。
- 每个启用项展示名称、状态、版本、可执行路径、最后检测时间、错误信息。
- preload 提供只读检测接口，只执行固定白名单命令。

### Slice 2: Git 只读查看增强

- Git 面板保留当前状态、变更文件、最近提交和提交树。
- 增加提交详情抽屉/弹窗：展示 hash、作者、日期、message、body、refs、文件变更列表。
- 支持按时间范围、作者、关键词过滤当前已加载 commits。
- 支持复制 hash / message / branch / file path。
- 支持查看指定 commit 的 diff 或文件变更摘要。

### Slice 3: AI 分析底座

- 设置里增加 AI Provider 配置：uTools 内置、OpenAI compatible、Anthropic compatible。
- uTools 内置模式读取 `utools.allAiModels()`。
- 第三方模式配置 Base URL、model、API Key。
- 第一批 AI 入口放在 Git 面板：总结选中 commits、总结时间范围 commits、解释 diff。
- AI 不自动执行 Git 命令，只消费现有只读 Git 数据。

## Assumptions

- 下一阶段应优先增强 Git 查看、环境查看和 AI 分析，而不是扩展成完整 IDE 或重型 Git 客户端。
- 新 UI 应继续使用现有 Element-less/Tailwind 风格、lucide 图标、紧凑工具型布局。
- Git 功能保持只读边界，不做会改变仓库或工作区的操作。
- AI 能力应服务于具体开发场景，避免先做无上下文的泛聊天。
- 环境页主视图应由用户配置决定展示项，避免信息过载。

## Open Questions

- 第一阶段是否按“可配置环境查看 + Git 只读查看增强”推进，并把 AI 接入放到第二阶段？

## Requirements (Evolving)

- 下一阶段规划围绕 Git 只读查看增强、可配置环境查看、AI 接入展开。
- Git 功能不做提交、暂存、丢弃、切换、拉取、推送等变动相关操作。
- 环境查看支持用户配置展示哪些软件环境信息。
- AI 接入需同时考虑 uTools 内置 AI 与第三方 OpenAI / Anthropic 兼容接口。

## Acceptance Criteria (Evolving)

- [ ] 已确认下一阶段功能方向。
- [ ] 已明确 MVP 范围与非目标。
- [ ] 已确认 Git 功能保持只读边界。
- [ ] 已确认环境页展示项可配置。
- [ ] 已确认 AI 第一批应用场景。
- [ ] 实施前完成相关规格上下文配置。

## Definition of Done

- 代码符合当前项目结构与样式约定。
- UI 与现有 Dashboard、ProjectDetails、SettingsTab 风格一致。
- 中英文文案同步更新。
- `npm run lint` 与 `npm run build` 通过。
- 必要时更新 README 或 Trellis spec。

## Out of Scope

- 未经确认不实施任何代码改动。
- 第一轮不引入需要外部服务或账号体系的能力。
- 第一轮不加入 Git 写操作，如 commit、stage、discard、push、pull、checkout、reset。
- 第一轮不做泛聊天机器人，除非确认这是明确需求。

## Technical Notes

- 已查看 `README.md`、`src/App.vue`、`src/store/useStore.ts`、`src/types.ts`、`public/preload.js`、`src/components/dashboard/Dashboard.vue`、`src/components/project/ProjectDetails.vue`、`src/components/project/ScriptsTab.vue`、`src/components/project/GitTab.vue`、`src/lib/projectBridge.ts`、`src/lib/i18n.ts`。
- 当前跨前端和 preload 桥接能力已经覆盖项目存储、路径检查、脚本运行、Git 读取、文件读取/写入、外部终端和编辑器打开。
- 当前 `public/preload.js` 已有 `findGitRoot`、`runGit`、`runGitDiff`、`readGitFileDiff` 等 Git 辅助函数，可作为 Git 增强基础。
- uTools AI 文档参考：`https://www.u-tools.cn/docs/developer/utools-api/ai.html`。
- uTools Agent 工具文档参考：`https://www.u-tools.cn/docs/developer/utools-api/tools.html`。
- uTools preload 文档参考：`https://www.u-tools.cn/docs/developer/information/preload.html`。
