# brainstorm: 折叠 AI 思考过程

## Goal

在 AI 生成结果中自动识别模型返回的思考过程，将其默认收起并允许用户展开查看，避免 Git 总览与 commit 详情里的 AI 文本过长，同时兼容 uTools 内置 AI、OpenAI 兼容接口和 Anthropic 兼容接口。

## What I already know

- 用户希望避免文本框/结果区域把模型思考过程和最终回答全部平铺展示。
- 用户明确要求兼容各类接口。
- 项目当前是前端 + `public/preload.js` 桥接的 uTools 插件，没有独立后端。
- AI 配置支持 `utools`、`openai-compatible`、`anthropic-compatible` 三类供应商。
- AI 结果展示位置主要有两处：Git 总览 AI 弹窗、单个 commit 详情 AI 分析面板。
- `GitTab.vue` 当前把 `aiDialogStreamingText` / `commitAiStreamingText` 直接渲染为 Markdown。
- `public/preload.js` 的 uTools 流式回调已把 `delta.reasoning_content` 和 `delta.content` 拼成同一个 chunk，这会导致 UI 无法区分思考与正文。
- OpenAI 兼容流式解析目前只读取 `delta.content` / `choices[0].text`；Anthropic 兼容解析只读取正文文本。

## Assumptions (temporary)

- 默认体验应该优先展示最终回答，思考过程默认收起。
- 如果接口提供结构化 reasoning 字段，应优先使用结构化字段；如果只在文本中包含 `<think>...</think>` 一类标记，则作为兼容兜底解析。
- 如果无法可靠识别思考过程，不应隐藏任何内容，避免误删用户需要的信息。

## Open Questions

- None.

## Requirements (evolving)

- AI 结果区域应把可识别的思考过程从最终回答中分离出来。
- 思考过程在生成过程中就进入单独的默认收起块，用户可以展开/收起查看。
- 最终回答继续实时流式显示，避免生成中刷出大段思考内容。
- 最终回答仍按现有 Markdown 样式渲染。
- 复制按钮应只复制正式回答内容，不包含已识别并收起的思考过程，行为对齐主流 AI 对话工具。
- 兼容 uTools 内置 AI 的 `reasoning_content` 流式字段。
- 兼容 OpenAI 兼容接口可能返回的 `reasoning_content`、`reasoning`、`thinking` 等字段。
- 兼容正文内嵌 `<think>...</think>`、`<thinking>...</thinking>`、`<reasoning>...</reasoning>` 标记的模型返回。
- 不识别或格式不完整时应回退为原样展示。

## Acceptance Criteria (evolving)

- [ ] uTools 流式返回 `reasoning_content` 时，思考内容进入收起块，正文进入结果正文。
- [ ] OpenAI 兼容流式返回结构化 reasoning 字段时，思考内容不会混入正文。
- [ ] 文本结果包含 `<think>...</think>` 时，标记内内容收起，标记外内容作为正文展示。
- [ ] 文本没有可识别思考内容时，展示效果与当前一致。
- [ ] Git 总览 AI 弹窗和 commit 详情 AI 面板的复制按钮只复制正式回答。
- [ ] Git 总览 AI 弹窗和 commit 详情 AI 面板表现一致。
- [ ] `npm run type-check` 通过。

## Definition of Done (team quality bar)

- Tests added/updated where practical for parsing logic.
- Lint / typecheck green.
- Specs/notes updated if a reusable AI result parsing convention is introduced.
- Rollout/rollback considered: parsing must be conservative,不能可靠识别时保留原文。

## Out of Scope (explicit)

- 不新增模型供应商。
- 不改变用户提示词内容。
- 不在本任务中实现 AI 请求取消/暂停。
- 不持久化 AI 生成历史。

## Technical Notes

- Likely files: `public/preload.js`, `src/types.ts`, `src/store/useStore.ts`, `src/components/project/GitTab.vue`, possibly a new shared parser/component under `src/lib/` or `src/components/`.
- Current AI bridge shape: `AiAnalyzeResult` only has `content` and optional `message`; stream chunk handler only receives `string`.
- A compatibility-friendly shape may need separate `content` and `reasoning` fields, plus chunk metadata so streaming UI can append each part correctly.
- Existing Markdown renderer is `src/lib/markdown.ts`; existing AI result styles live in `src/index.css` under `.ai-result-panel` and `.ai-markdown-result`.

## Feasible Approaches

### Approach A: Display-only text parser

Parse `aiDialogDisplayResult` / `commitAiDisplayResult` in the Vue layer and collapse only recognized text markers such as `<think>...</think>`.

Pros:

- Smallest surface area.
- No bridge/type changes.

Cons:

- Cannot correctly handle uTools `reasoning_content`, because preload already merged it with正文 and no marker remains.
- Weak compatibility for structured interface fields.

### Approach B: Structured bridge + conservative fallback parser (Recommended)

Preserve reasoning separately in bridge/types/stream chunks when providers expose structured fields, then use a shared parser to additionally split inline markers in final text. The UI renders a shared collapsible reasoning block plus final Markdown body.

Pros:

- Best compatibility across uTools, OpenAI-compatible, Anthropic-compatible and text-marker models.
- Avoids hiding content unless识别可靠。
- Gives both AI result panels one consistent rendering path.

Cons:

- Touches bridge types, preload stream parsing, store handlers, and UI rendering.

### Approach C: Prompt-level convention

Modify prompts to ask every model to wrap reasoning in a fixed tag or avoid outputting reasoning.

Pros:

- Simple to implement.

Cons:

- Not reliable across models/providers.
- Does not solve existing structured `reasoning_content` streams.
- Changes model behavior instead of robustly adapting to provider responses.

## Decision (ADR-lite)

**Context**: Current implementation merges AI reasoning and answer into one text stream, causing overly long output and preventing UI from hiding reasoning safely.

**Decision**: Use Approach B. Preserve structured reasoning separately in bridge/types/stream chunks when providers expose it, split inline reasoning tags as a conservative fallback, and render reasoning in a real-time collapsible block that is collapsed by default.

**Consequences**: More files touched, but establishes a reusable AI response structure and conservative fallback behavior.
