# Research: AI Provider Configuration UX

- **Query**: Research common AI provider configuration UX patterns in tools like Cherry Studio, Chatbox, and similar local AI chat clients. Focus on provider presets, custom OpenAI-compatible endpoints, API key handling, base URL/model defaults, model list refresh/manual entry, connection test behavior, and prompt/mode management UX.
- **Scope**: mixed, primarily external source/documentation review
- **Date**: 2026-05-22

## Findings

### Files Found

| File Path | Description |
|---|---|
| `CherryHQ/cherry-studio/src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx` | Provider settings screen: enable switch, API key field, multi-key popup, base URL input/preview, connection check, provider-specific auth/options, model list embedding. |
| `CherryHQ/cherry-studio/src/renderer/src/aiCore/services/listModels.ts` | Unified model-list fetching service with provider-specific strategies and OpenAI-compatible `/models` fallback. |
| `CherryHQ/cherry-studio/src/renderer/src/components/Popups/ApiKeyListPopup/hook.ts` | Multi-API-key management: split/dedupe, duplicate validation, per-key and all-key connectivity tests, latency/status tracking, invalid-key removal. |
| `CherryHQ/cherry-studio/src/renderer/src/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts` | Model health-check flow: choose API keys, choose concurrent/sequential behavior and timeout, update per-model status, summarize results. |
| `CherryHQ/cherry-studio/src/renderer/src/types/index.ts` | Assistant/prompt/mode data model: prompt, model/defaultModel, web search, URL context, image generation, MCP mode, thinking/reasoning settings, quick phrases. |
| `chatboxai/chatbox/src/renderer/routes/settings/provider/$providerId.tsx` | Provider settings page: built-in and custom provider forms, API mode select, OAuth/API-key modes, API host/path preview, manual models, fetch models, check model, test result modal. |
| `chatboxai/chatbox/src/renderer/packages/model-setting-utils/custom-provider-setting-util.ts` | Custom provider model-list utility across OpenAI-compatible, OpenAI Responses, Claude-compatible, and Gemini-compatible APIs. |
| `chatboxai/chatbox/src/shared/providers/definitions/models/custom-openai.ts` | OpenAI-compatible custom provider runtime: normalized host/path, `createOpenAICompatible`, custom fetch to API path, remote model listing. |
| `chatboxai/chatbox/src/shared/models/openai-compatible.ts` | Shared OpenAI-compatible model wrapper and `/models` fetcher, including Bearer auth, OpenRouter metadata mapping, capability inference. |
| `chatboxai/chatbox/src/renderer/modals/SessionSettings.tsx` | Conversation-level prompt and mode settings: system prompt, model settings reset, temperature/top-p/max tokens, stream output, thinking budget/effort controls. |

### Code Patterns

#### 1. Provider presets plus editable provider detail pages

Cherry Studio treats each provider as a first-class settings page with a provider title, optional official/API-key links, an enable switch, provider-specific auth blocks, API key/base URL fields, and an embedded model list. Evidence: `ProviderSetting.tsx` shows the API-key list popup call at line 253, connection check handler at line 260, host preview helper at line 332, API-key password input at line 518, API-host preview text at line 611, and `<ModelList providerId={provider.id} />` at line 664.

Chatbox uses a similar single route for both built-in and custom providers. Built-in providers get normalized API host/path previews, while custom providers expose name and API mode. Evidence: `routes/settings/provider/$providerId.tsx` has custom provider `API Mode` at line 545 and `OpenAI API Compatible` as one option at line 559; built-in API host starts around line 701 with normalized preview at line 721; custom API host/path fields start around line 728 with API host at line 734, API path at line 750, path placeholder normalization at line 758, and joined preview at lines 764-765.

UX pattern: keep a curated provider list for common services, but let every preset remain editable. Presets should prefill provider name, type, default base URL/path, default models, and documentation/API-key links. Custom providers should ask for provider name and compatibility mode before API credentials.

#### 2. Custom OpenAI-compatible endpoints are usually host + optional path, not only one URL field

Chatbox explicitly separates API Host and API Path for custom providers, then shows the effective joined endpoint. Its public guide instructs users to fill API key and API host, with API path usually left empty/defaulting to `/v1/chat/completions`, and to choose API type such as OpenAI-compatible or Google Gemini-compatible. Source: https://docs.chatboxai.app/guides/providers.

Chatbox runtime normalizes host/path in `custom-openai.ts`, calls `createOpenAICompatible` with `baseURL: this.options.apiHost`, and sends chat requests through a custom fetch to `${apiHost}${apiPath}`. It lists remote models from `apiHost` rather than the chat path. Evidence: `custom-openai.ts` imports/uses `normalizeOpenAIApiHostAndPath` near line 8, calls `createOpenAICompatible` near line 49, sends via `${apiHost}${apiPath}` around line 65, and exposes `public listModels()` around line 71.

Cherry Studio uses a single `apiHost` field but displays concrete endpoint previews based on provider type, e.g. OpenAI-compatible `/chat/completions`, OpenAI `/responses`, Anthropic `/messages`, Gemini `/models`, Ollama `/chat`. Evidence: `ProviderSetting.tsx` host preview helper at line 332 and preview rendering at line 611.

UX pattern: either split `Base URL` and `API Path`, or keep one base URL field with a live effective endpoint preview. For OpenAI-compatible custom providers, the UI should avoid forcing users to understand whether they entered `/v1`, `/chat/completions`, or a proxy path without showing the normalized result.

#### 3. API keys are password fields, can be checked, and often support multiple keys

Cherry Studio formats API keys, debounces saving, resets connectivity state when the key changes, and uses a password input plus a `Check` button. Multiple comma-separated keys open the key-list manager instead of running a single check. Evidence: `ProviderSetting.tsx` connection check handler at line 260, password input at line 518, and key-list popup at line 253.

Cherry Studio's key-list hook parses keys with `splitApiKeyString`, deduplicates, rejects empty/duplicate entries, can remove failed keys, checks one key or all keys, records latency, and uses `Promise.allSettled` for all-key checks. Evidence: `ApiKeyListPopup/hook.ts` key parsing at lines 46-49, validation at line 87, invalid-key removal at line 174, connectivity runner at line 192, latency capture at lines 211 and 218, and all-key check at lines 257 and 263.

Chatbox uses a password input and disables `Check` until an API key and at least one model exist. Evidence: `routes/settings/provider/$providerId.tsx` API-key `PasswordInput` at line 672, disabled/check prerequisites at lines 683 and 690.

UX pattern: API key entry should be masked, saved immediately or on blur with no separate fragile save step, and show validation state near the field. Advanced clients often support multiple keys for rotation or fallback; when multiple keys exist, test/manage them in a dedicated modal with per-key status, latency, and bulk actions.

#### 4. Model defaults should be editable, refreshable, and manually overridable

Cherry Studio uses a unified `listModels(provider)` service. Provider-specific fetchers cover Ollama, Gemini, Vertex, GitHub, Copilot, OVMS, Together, New API, OpenRouter, PPIO, AIHubMix, and Vercel Gateway; the last fallback is OpenAI-compatible `/models`. Evidence: `listModels.ts` OpenAI-compatible fallback comment at line 480, fetcher at lines 481-493, `url: `${baseUrl}/models`` at line 486, and public `listModels` at line 523. API key rotation for listing is handled in `getApiKey` at line 92 and default headers include both `Authorization: Bearer` and `X-Api-Key` at line 118.

Chatbox exposes model actions in provider settings: `New`, `Reset`, and `Fetch`. Fetched remote models open in a modal where users can add/remove models; manual entries are edited with model metadata/capabilities. Evidence: `routes/settings/provider/$providerId.tsx` fetch handler at line 363, model action refresh icon at lines 970-971, and the remote model modal/model list around the fetch flow. `openai-compatible.ts` fetches `${params.apiHost}/models` at line 118 onward, sends `Authorization: Bearer ${params.apiKey}` at line 126, maps OpenRouter context window at line 147, and infers capabilities such as vision/web_search/reasoning at lines 156, 161, and 166.

UX pattern: ship default model presets, but make the model list user-owned. Provide `Fetch/Refresh` from the provider API, `New` for manual model IDs, `Reset` to defaults, edit/delete actions, search/filter inside fetched results, and optional capability flags when remote metadata is incomplete.

#### 5. Connection tests usually select a model and test more than authentication

Cherry Studio's single-provider check requires at least one non-rerank model, opens a model-selection popup, calls `checkApi`, shows success/failure toast, temporarily changes button state to success, and stores serialized error details for a warning icon. Evidence: `ProviderSetting.tsx` check handler at line 260 and model-selection/error behavior in that function.

Cherry Studio's health-check flow can run across many models and keys. It allows empty key for local model providers, opens a health-check options popup, initializes per-model statuses, updates each result progressively, and summarizes results. Evidence: `ModelList/useHealthCheck.ts` uses split keys and fallback empty key, `HealthCheckPopup.show`, `checkModelsHealth`, per-result updates, and `summarizeHealthResults`.

Chatbox's check flow asks the user to select a test model, then displays a `Model Test Results` modal with text request, vision request, and tool-use request results. Evidence: selected test model modal at line 1012, test result modal at line 1133, success label at line 1148, and failure label at line 1209. The check handler starts around line 409.

UX pattern: avoid a generic “API key valid” check. Use a selected model to perform a minimal text request, optionally probe feature capabilities such as vision/tool use, and report success/failure in terms users can act on. Disable checks until credentials and at least one model are configured. For local providers, allow keyless checks.

#### 6. OAuth and API-key modes can coexist for selected providers

Chatbox supports OAuth flows for some providers and exposes an auth-mode segmented control when both OAuth and API key are available. The provider settings page handles callback, code-paste, and device-code flows; API-key fields are dimmed/disabled when OAuth is active. Evidence: `routes/settings/provider/$providerId.tsx` imports `SegmentedControl`, defines OAuth provider fallbacks and flows, has `handleAuthModeChange`, and renders API-key/OAuth mode controls in the authentication section.

Cherry Studio also has provider-specific OAuth/auth blocks, including Anthropic auth method selection and provider OAuth components. Evidence: `ProviderSetting.tsx` imports `ProviderOAuth`, `CherryINOAuth`, `AnthropicSettings`, and renders provider auth blocks before API-key fields.

UX pattern: preserve API key as the universal path, but allow OAuth/device-code login for consumer accounts where applicable. When OAuth is active, visually communicate which auth mode is being used and avoid letting disabled API-key fields look broken.

#### 7. Prompt/mode management sits near conversations or assistants, not inside provider credentials

Cherry Studio models assistant-level behavior separately from provider credentials. The `Assistant` type includes `prompt`, `model`, `defaultModel`, `enableWebSearch`, `webSearchProviderId`, `enableUrlContext`, `enableGenerateImage`, `mcpMode`, `mcpServers`, `regularPhrases`, `enableMemory`, and `settings`. `AssistantSettings` includes max tokens, temperature, top-p, context count, stream output, default model, custom parameters, reasoning effort, tool-use mode, and max tool calls. Evidence: `types/index.ts` assistant definition and settings block, including `McpMode = 'disabled' | 'auto' | 'manual'` and reasoning/tool settings.

Chatbox places prompt and per-conversation model settings in `Conversation Settings`: name/avatar, `Instruction (System Prompt)`, `Specific model settings`, context count, temperature, top-p, max output tokens, stream output, and provider-specific thinking controls. Evidence: `SessionSettings.tsx` system prompt label at line 226, specific model settings at line 243, thinking budget at line 464, thinking effort at line 643, temperature at line 760, top-p at line 782, max output tokens at line 804, and stream output at line 835.

UX pattern: provider configuration should answer “how do I call this API?” Prompt/mode configuration should answer “how should this assistant/conversation behave?” Keep them linked through default model selection, but avoid mixing API credentials with prompt editors. Use segmented controls for modes like thinking effort, MCP/tool mode, auth mode, or response mode.

#### 8. Similar clients reinforce the same primitives

Chatbox's public guide documents the user path: settings > model providers > add provider if missing > select API type > fill API key/API host/API path > add at least one model and optional capabilities > save > click check for connection success. Source: https://docs.chatboxai.app/guides/providers.

Open WebUI exposes OpenAI API configuration through environment/config primitives such as `OPENAI_API_KEY` and `OPENAI_API_BASE_URL` in `backend/open_webui/config.py`, and has UI strings for `OpenAI API Base URL` in `src/lib/components/admin/Settings/Images.svelte`. This reinforces the base URL + API key pair as a cross-tool convention, though the reviewed evidence is more admin/config oriented than local-desktop UX oriented.

## External References

- [Chatbox provider setup guide](https://docs.chatboxai.app/guides/providers) — documents the product UX for adding a custom provider, selecting API compatibility type, filling API key/API host/API path, adding models/capabilities, and running a connection check.
- [Cherry Studio ProviderSetting source](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx) — provider detail UX and connection check source.
- [Cherry Studio ModelListService source](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/src/aiCore/services/listModels.ts) — provider-specific and OpenAI-compatible model list fetching behavior.
- [Chatbox provider settings source](https://github.com/chatboxai/chatbox/blob/main/src/renderer/routes/settings/provider/%24providerId.tsx) — provider form, custom API mode, model actions, OAuth/API-key behavior, connection testing modal.
- [Chatbox OpenAI-compatible source](https://github.com/chatboxai/chatbox/blob/main/src/shared/models/openai-compatible.ts) — OpenAI-compatible `/models` request and model metadata mapping.
- [Open WebUI config source](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/config.py) — confirms common OpenAI API key/base URL configuration primitives.

## Related Specs

- Not reviewed. The request was external UX research only, and no local implementation/spec update was requested.

## Caveats / Not Found

- Open WebUI and LibreChat documentation pages did not yield extractable content through the available webpage fetcher. Open WebUI was represented through public source search instead.
- Quick lexical searches for LobeChat and Jan did not return focused provider-configuration UX snippets with the initial queries, so they are not used as primary evidence here.
- This research intentionally does not inspect or change the local app implementation; it captures UX patterns for later design/implementation work.

## Practical UX Takeaways

- Start with provider presets and a visible custom-provider path.
- For custom endpoints, support OpenAI-compatible mode first, but consider OpenAI Responses, Claude-compatible, and Gemini-compatible modes if the app scope includes them.
- Show `Base URL`/`API Path` normalization or endpoint preview so users can diagnose `/v1` and path mistakes.
- Mask API keys, support provider documentation/API-key links, and make connection status visible next to the credential field.
- Support model defaults plus `New`, `Reset`, and `Fetch/Refresh`; fetched model results should be selectively importable, not automatically destructive.
- Require a model for connection tests, and test a real minimal request. Capability probes for vision/tool use are valuable when the app exposes those features.
- Keep provider credentials separate from assistant/conversation prompt and mode settings, linked only by model/default-model selection.