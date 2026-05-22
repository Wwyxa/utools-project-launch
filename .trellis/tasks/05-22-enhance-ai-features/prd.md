# 完善 AI 相关功能

## Goal

完善项目中的 AI 能力，让 Git 面板中的两个 AI 生成入口具备真正的响应流体验，并把设置页升级为更接近常用 AI 对话工具的配置中心：供应商配置更便利、可测试，AI 模式和提示词可维护、可扩展。

## What I Already Know

- 当前 AI 功能主要有两个入口，均位于 Git 面板：提交列表范围的“AI生成”和单个提交详情中的 AI 总结。
- 当前固定三种模式：`summary`、`analysis`、`evaluation`，模式标签和提示词硬编码在 `GitTab.vue` 中。
- 当前设置页 AI 配置只有 provider 分段控件、单模型选择/输入、Base URL、API Key、刷新模型和简单测试。
- 当前 provider 类型只有 `utools`、`openai`、`anthropic`。
- `public/preload.js` 已经有 OpenAI/Anthropic 第三方 SSE 解析雏形；uTools 内置 AI 分支目前调用非流式 `analyzeWithAi`，拿到完整结果后一次性 `chunk(result.content)`，不是真正流式。
- 浏览器预览 fallback bridge 的 `analyzeWithAiStream` 也是一次性返回，用于预览环境的降级行为。
- 外部 UX 研究已写入 `research/ai-provider-configuration-ux.md`。结论倾向于：供应商凭证配置与提示词/模式管理应分区展示；常用供应商用预设降低配置成本，同时保留自定义兼容端点；模型列表要支持刷新和手动补充；连接测试要基于真实模型请求。

## Assumptions

- 本任务聚焦当前前端/uTools preload 实现，不新增后端服务。
- 供应商配置优先支持：uTools 内置、OpenAI-compatible、Anthropic-compatible；OpenAI Responses 本次暂不实现，优先完成其他 AI 配置、流式和模式管理改进。
- “真正流式输出”指在 API 响应增量到达时即更新 UI，而不是请求结束后一次性把完整文本写入结果面板。
- 如果 uTools 官方内置 AI API 没有暴露流式能力，则不做假流式切字；应保留明确的降级提示或只对支持流式的第三方 provider 提供真实流式。

## Open Questions

- 暂无阻塞问题；供应商范围已确认。

## Requirements

- 两个 Git 面板 AI 入口都使用同一套流式调用能力，流式片段到达后立即追加到 Markdown 结果区域。
- 第三方 OpenAI-compatible / Anthropic-compatible provider 的流式请求必须使用真实 SSE/ReadableStream 增量输出，并正确处理错误、空响应和非流式环境。
- uTools 内置 AI 分支需要验证官方 API 是否支持流式；支持则接入真实流式，不支持则明确降级，不制造“假流式”。
- 设置页 AI 区域重新排版，减少纵向空白和冗余，分为供应商配置、模型/测试、模式提示词管理等清晰区域。
- AI 供应商配置提供 uTools、OpenAI-compatible、Anthropic-compatible 三类配置能力；OpenAI-compatible 和 Anthropic-compatible 可自定义 Base URL、模型和 API Key。
- API Key 使用密码输入，保存在本地 uTools/localStorage 存储，不在界面回显明文；提供清晰的配置完整性状态。
- 模型配置支持刷新/获取模型列表，也支持手动输入或添加模型 ID，避免接口不可列出模型时无法使用。
- 连接测试要用当前配置的模型发起最小请求，并给出可行动的成功/失败信息；测试状态不能只显示“失败/成功”而隐藏具体原因。
- AI 模式从硬编码三种改为可配置列表，支持查看/编辑提示词、自定义新增模式、删除自定义模式、恢复默认模式。
- 默认模式至少保留总结、分析、评估；内置默认模式可编辑但应能恢复，不应因为删除导致两个 AI 入口无模式可选。
- 两个 AI 入口都使用设置页配置的模式列表和提示词模板生成 prompt，并根据上下文填充提交列表或单个提交信息。
- 设置数据需要向后兼容现有 `AiPreferences` 存储，旧用户升级后仍能保留 provider/baseUrl/model/apiKey。

## Acceptance Criteria

- [ ] 在支持流式的第三方 provider 下，点击两个 AI 入口的“生成”后，结果面板会随着网络流增量更新，而不是等待请求结束才出现完整内容。
- [ ] 第三方流式请求失败时，UI 停止 loading，并显示具体错误信息，不残留“生成中”。
- [ ] 设置页能选择 uTools、OpenAI-compatible、Anthropic-compatible，并能配置对应 Base URL、模型和 API Key。
- [ ] 设置页能刷新模型、手动设置模型、测试当前模型连接，并显示具体测试结果。
- [ ] 设置页能新增、编辑、删除自定义 AI 模式，并能恢复默认模式。
- [ ] Git 面板两个 AI 模式下拉使用设置页模式列表；新增或修改提示词后生成内容会使用最新配置。
- [ ] 旧版 AI 设置可被正常读取并迁移到新版结构。
- [ ] `npm run lint` 通过。

## Definition of Done

- Lint/type-check 通过。
- 关键数据迁移与空配置边界经过验证。
- 供应商配置、模型测试、模式管理的 UI 在常见桌面窗口宽度下无明显重叠、溢出和大面积空白。
- 行为变化和实现约束已在任务记录或 spec 中按需沉淀。

## Out of Scope

- 不新增云端同步、多设备同步或后端代理服务。
- 不实现完整多 API Key 轮询/负载均衡；可为后续保留数据结构余地。
- 不实现 OpenAI Responses、大量第三方供应商预设、OAuth 登录、工具调用、图片/视觉能力探测。
- 不把 AI 生成结果自动写入 Git、提交信息或项目文件。

## Technical Notes

- 主要相关文件：`src/types.ts`、`src/store/useStore.ts`、`src/lib/projectBridge.ts`、`public/preload.js`、`src/components/layout/SettingsTab.vue`、`src/components/project/GitTab.vue`、`src/lib/i18n.ts`、`src/index.css`。
- 现有第三方流式相关函数：`callThirdPartyAiStream`、`readSseStream`、`extractOpenAiStreamDelta`、`extractAnthropicStreamDelta`。
- 现有 uTools 内置 AI 非流式路径：`analyzeWithAiStream` 中 `preferences.provider === "utools"` 分支调用 `analyzeWithAi` 后一次性 chunk。
- 现有两个 AI 入口：`generateAiAnalysis` 和 `generateCommitAiAnalysis`。
- 外部 UX 研究：`.trellis/tasks/05-22-enhance-ai-features/research/ai-provider-configuration-ux.md`。

## Risks

- uTools 内置 AI 是否支持官方真实流式仍需实现期验证；如果不支持，本任务不能用假流式替代，只能明确降级。
- 不同 OpenAI-compatible 服务对 `/models`、`/chat/completions`、Base URL 是否包含 `/v1` 的要求不一致，需要做可解释错误和手动模型兜底。
- 设置页重排涉及较多状态和持久化结构，需谨慎处理旧数据兼容。