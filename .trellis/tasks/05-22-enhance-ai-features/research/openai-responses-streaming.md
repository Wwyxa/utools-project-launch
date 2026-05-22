# Research: OpenAI Responses API Streaming

- **Query**: Research OpenAI Responses API streaming behavior for implementing a local JS `fetch` client. Cover endpoint path, request body basics, required headers, `stream: true`, SSE event types carrying output text deltas/completion/errors, how to extract text incrementally, and how it differs from Chat Completions streaming.
- **Scope**: external
- **Date**: 2026-05-22

## Findings

### Files Found

| File Path | Description |
|---|---|
| `openai/openai-node/src/resources/responses/responses.ts` | SDK type source confirming Responses streaming event interfaces and literal event names. |
| `openai/openai-node/src/core/streaming.ts` | SDK SSE parser behavior: parses SSE data as JSON, treats `event: error` specially, and yields typed events. |

### Code Patterns

Endpoint and transport:

- Create a streaming response with `POST https://api.openai.com/v1/responses` (`POST /responses` in the API reference under the `/v1` base URL).
- Required request headers for a local `fetch` client are `Authorization: Bearer <OPENAI_API_KEY>` and `Content-Type: application/json`.
- `Accept: text/event-stream` is useful for clarity but is not shown as a required OpenAI header in the create-response curl examples.
- The HTTP response body is an SSE stream when the JSON body includes `"stream": true`.

Request body basics:

- Practical minimum for ordinary text generation is `model`, `input`, and `stream: true`.
- `input` can be a plain string or an array of message-like input items such as `{ "role": "user", "content": "..." }`.
- Common optional fields include `instructions`, `previous_response_id`, `conversation`, `max_output_tokens`, `temperature`, `top_p`, `text`, `tools`, `tool_choice`, `reasoning`, `store`, and `stream_options`.
- `stream_options` should only be sent with `stream: true`.

SSE parsing for local JS `fetch`:

- Read `response.body` with a `ReadableStreamDefaultReader`, decode bytes with `TextDecoder`, buffer text, and split on blank-line SSE frame separators (`\n\n`, while tolerating `\r\n`).
- For each frame, collect `event:` and one or more `data:` lines. Join multi-line `data:` payloads with newlines before `JSON.parse`.
- OpenAI Responses streaming data payloads are JSON objects whose `type` property is the semantic event name. Some lower-level SSE parsers also expose the SSE `event` field; the payload `type` is the stable discriminator to switch on.
- For incremental visible assistant text, append `event.delta` whenever `event.type === "response.output_text.delta"`.
- Treat `response.output_text.done` as the end of one finalized text content part. It carries the final `text` for that part, so a client can reconcile the accumulated text for that content part if needed.
- Treat `response.completed` as the whole response completion event. It carries the final `response` object, including status and output data.
- Treat `response.failed`, `response.incomplete`, and `error` / `response.error` events as terminal or user-visible failure states. The streaming guide lists `error`; the API reference model list includes `ResponseErrorEvent`, `ResponseFailedEvent`, and `ResponseIncompleteEvent`.

Relevant Responses streaming event types for text:

- `response.created`: response object was created.
- `response.in_progress`: generation is in progress.
- `response.output_item.added`: a new output item was added.
- `response.content_part.added`: a new content part was added.
- `response.output_text.delta`: visible output text delta; append `delta` to the UI.
- `response.output_text.done`: final text content part; contains final `text`.
- `response.content_part.done`: content part completed.
- `response.output_item.done`: output item completed.
- `response.completed`: full response completed; contains final `response`.
- `response.failed`: full response failed; contains failed `response` with error/status details.
- `response.incomplete`: full response ended incomplete, for example due to output limits.
- `error` / `response.error`: stream-level or API error event with `code`, `message`, `param`, and event metadata depending on source.

SDK/source confirmation:

- `openai-node` confirms `ResponseTextDeltaEvent` and the literal `type: 'response.output_text.delta'` in `src/resources/responses/responses.ts` around lines 6073 and 6107.
- `openai-node` confirms `ResponseTextDoneEvent` and the literal `type: 'response.output_text.done'` around lines 6151 and 6185.
- `openai-node` confirms `ResponseCompletedEvent` and the literal `type: 'response.completed'` around lines 1704 and 1718.
- `openai-node` confirms `ResponseErrorEvent`, `ResponseFailedEvent`, and `type: 'response.failed'` around lines 2471, 2501, and 2515.

Difference from Chat Completions streaming:

- Responses API streams semantic event objects. The client switches on `event.type` and reads text from `event.delta` for `response.output_text.delta`.
- Chat Completions streams `chat.completion.chunk` objects from `POST /v1/chat/completions`. Text is nested under `chunk.choices[index].delta.content`; completion is indicated by each choice's `finish_reason` rather than a top-level `response.completed` semantic event.
- Responses streaming includes lifecycle and tool/content-part events (`response.created`, `response.output_item.*`, `response.content_part.*`, `response.completed`, tool-call deltas), so a fetch client should ignore unknown event types and only append text for `response.output_text.delta` unless it intentionally supports tools or structured output.
- Chat Completions may end with a `[DONE]` sentinel in classic SSE handling; Responses clients should rely on semantic events such as `response.completed`, `response.failed`, `response.incomplete`, and `error`, plus normal stream closure.

### External References

- [OpenAI API reference: Create a model response](https://developers.openai.com/api/docs/api-reference/responses/create) — endpoint, required curl headers, request body parameters, and `stream` / `stream_options` behavior.
- [OpenAI guide: Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses) — SSE behavior, `stream=True`, semantic event model, and common text events.
- [OpenAI API reference: Responses streaming events](https://developers.openai.com/api/docs/api-reference/responses-streaming) — event model list including text delta/done, completed, failed, incomplete, and error events.
- [OpenAI API reference: Chat Completions](https://developers.openai.com/api/docs/api-reference/chat/create) — Chat Completions endpoint and streamed `ChatCompletionChunk` shape for comparison.
- [openai-node source](https://github.com/openai/openai-node) — TypeScript event interfaces and SSE parsing behavior used as a practical implementation cross-check.

### Related Specs

- Not checked; this research is API behavior only and does not modify repository code or Trellis specs.

## Caveats / Not Found

- The OpenAI docs site currently redirects some old `platform.openai.com/docs/api-reference/...` URLs to `developers.openai.com`; old direct API-reference URLs may return 404.
- The docs list `model` and `input` as optional in the generic schema because other modes such as prompt templates, conversations, or specialized inputs exist. For a normal local text client, send both explicitly.
- Event coverage above focuses on visible text streaming. Tool calls, audio, image generation, reasoning summaries, and structured-output streaming have additional event types that should be handled only if those features are enabled.