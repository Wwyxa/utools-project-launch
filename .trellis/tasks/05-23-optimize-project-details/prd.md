# 优化项目细节

## Goal

修复项目启动器中命令停止、首页脚本按钮和终端日志交互的细节问题，并纠正上次任务中关于 uTools 内置 AI 不支持流式输出的错误知识。最终体验应是：停止命令反馈即时且不卡顿，首页卡片上的脚本按钮不会在停止瞬间跳位，日志/终端可以向运行中的进程输入内容，uTools AI 使用真实流式能力。

## What I Already Know

- 用户确认 uTools 内置 AI 支持流式响应，官方文档为 `https://www.u-tools.cn/docs/developer/utools-api/ai.html`。
- 已将外部文档研究沉淀到 `research/utools-ai-streaming.md`。
- 当前 `public/preload.js` 的 `analyzeWithAiStream` 对 uTools provider 仍调用非流式 `analyzeWithAi`，并返回“当前不支持真实流式”的消息，这是错误知识。
- 当前停止脚本的 Pinia action 已先把 UI 状态改为 `STOPPED`，再用 `setTimeout` 调 `bridge.stopProcess(pid)`，但首页脚本可见列表会把运行中脚本优先排序，停止点击后脚本立刻从前面跳到后面。
- 当前 `public/preload.js` 的 `stopProcess` 在 Windows 下同步执行 PowerShell 杀进程树，可能造成 preload/桥接调用卡顿。
- 当前终端面板只展示 stdout/stderr，没有 stdin 输入能力；`ProjectBridge` 类型也没有发送输入的 API。

## Requirements

- uTools 内置 AI 流式：
  - `analyzeWithAiStream` 对 `provider === "utools"` 使用 `window.utools.ai(option, streamCallback)`。
  - 流式 chunk 同时兼容 `content` 与 `reasoning_content`，逐步透传给现有 UI 的 `onChunk`。
  - 完成时返回聚合后的完整 content，不再提示“不支持真实流式”。
  - 保留非流式 `analyzeWithAi` 作为普通完整响应路径。
- 停止命令体验：
  - 点击停止后 UI 立即反馈，不等待实际杀进程树完成。
  - Windows 进程树终止不应使用同步阻塞方式卡住界面。
  - 停止中的进程不应被后续 exit 事件错误刷成 ERROR。
  - 日志保留用户主动停止的语义。
- 首页卡片脚本按钮稳定性：
  - 当首页可见脚本由“运行中优先”决定时，点击停止当前运行脚本后，按钮在停止反馈期间不要立刻跳到后排。
  - 卡片上的脚本按钮应保持清晰的运行、停止中、可启动状态。
- 终端交互：
  - 日志/终端面板支持向当前选中的运行脚本发送按行 stdin 输入。
  - 输入框只在有可交互的运行脚本时启用，按 Enter 发送一行输入；本任务暂不实现完整 xterm/TUI。
  - 支持用户给需要交互参数的命令输入文本，并把输入行为记录到对应脚本日志。
  - 如果当前选中的日志目标不是运行中脚本，应给出禁用态或提示，而不是丢输入。
- 规范/知识更新：
  - 修改 `.trellis/spec/` 或其他项目知识文件，明确 uTools 内置 AI 支持 `utools.ai(option, streamCallback)` 流式调用，避免后续任务再次沿用错误判断。

## Acceptance Criteria

- [ ] uTools provider 的 AI 分析能通过现有 `analyzeWithAiStream` 路径收到增量 chunk。
- [ ] uTools provider 的流式完成结果聚合正确，完成消息不再声称 uTools 内置 AI 不支持流式。
- [ ] 点击停止运行中命令时，按钮/状态立即改变，界面不等待 Windows PowerShell 杀进程同步完成。
- [ ] 首页卡片上有两个脚本时，停止前面运行中脚本后，该按钮在停止反馈期间不立刻跳位到后面。
- [ ] 终端面板可对选中运行脚本发送 stdin，发送后日志中能看到用户输入记录。
- [ ] 无运行脚本或选中脚本不可输入时，终端输入框不可用并显示明确占位。
- [ ] `npm run lint` 通过。
- [ ] 相关 spec/知识文档已更新。

## Out Of Scope

- 不实现完整 xterm.js 级别的伪终端、光标控制、ANSI 交互渲染或全屏 TUI。
- 不新增 AI Function Calling UI。
- 不改外部终端启动策略。
- 不重做整个首页卡片布局。

## Technical Notes

- 关键文件：`public/preload.js`、`src/store/useStore.ts`、`src/types.ts`、`src/components/terminal/Terminal.vue`、`src/components/dashboard/ProjectCard.vue`、`src/components/project/ScriptsTab.vue`。
- uTools 流式研究：`.trellis/tasks/05-23-optimize-project-details/research/utools-ai-streaming.md`。
- 推荐实现：新增脚本状态（如停止中）或局部 pending 状态来区分“用户已请求停止但进程尚未 close”；preload 侧改为异步 kill；桥接增加 `sendProcessInput(pid, input)` 或同等窄 API。
