# Research: uTools AI streaming

- **Query**: Research the uTools built-in AI API streaming support from https://www.u-tools.cn/docs/developer/utools-api/ai.html for the active task .trellis/tasks/05-23-optimize-project-details.
- **Scope**: external
- **Date**: 2026-05-23

## Findings

### Files Found

| File Path | Description                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| N/A       | External documentation research only; no repository code files were searched for this topic. |

### Code Patterns

uTools exposes built-in AI through `utools.ai(option[, streamCallback])`. Streaming is enabled by passing the second argument callback:

```ts
function ai(option: AiOption, streamCallback: (chunk: Message) => void): PromiseLike<void>;
```

Non-streaming omits the callback and resolves to a `Message`:

```ts
function ai(option: AiOption): PromiseLike<Message>;
```

`AiOption` supports model selection, chat messages, and optional tools:

```ts
interface AiOption {
  model?: string;
  messages: Message[];
  tools?: Tool[];
}
```

Important fields:

- `model` is optional. If empty, uTools defaults to `deepseek-v3`.
- `messages` is required and contains the conversation history.
- `tools` is optional and enables Function Calling.

The stream callback receives `Message` chunks/deltas. The documented `Message` shape is:

```ts
interface Message {
  role: "system" | "user" | "assistant";
  content?: string;
  reasoning_content?: string;
}
```

`reasoning_content` is documented as reasoning output, generally returned only by reasoning models. This means streaming consumers should be prepared to append both `content` and `reasoning_content` deltas when present.

The returned value is a custom promise with cancellation support:

```ts
interface PromiseLike<T> extends Promise<T> {
  abort(): void;
}
```

For streaming calls, the promise resolves as `void`; streamed data is delivered only through the callback. For non-streaming calls, the promise resolves to the final `Message`.

The AI conversation streaming example uses:

```js
await utools.ai({ messages }, (chunk) => {
  console.log(chunk);
});
```

Function Calling is supported in both streaming and non-streaming examples. Streaming with tools uses:

```js
await utools.ai({ messages, tools }, (delta) => {
  console.log(delta);
});
```

Function Calling requires callable functions to be attached to `window`, for example `window.getSystemInfo`.

Available model metadata can be retrieved with:

```ts
function allAiModels(): Promise<AiModel[]>;
```

`AiModel` fields are:

```ts
interface AiModel {
  id: string;
  label: string;
  description: string;
  icon: string;
  cost: number;
}
```

The `AiModel.id` value is the value to pass as `AiOption.model`.

### External References

- [uTools AI API documentation](https://www.u-tools.cn/docs/developer/utools-api/ai.html) — Documents `utools.ai(option[, streamCallback])`, streaming and non-streaming signatures, message/tool/model types, `abort()`, examples, and Function Calling requirements.

### Related Specs

- None found or loaded for this external API research topic.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` returned no active task, so this research was persisted to the explicitly requested task path: `.trellis/tasks/05-23-optimize-project-details/research/utools-ai-streaming.md`.
- The documentation does not describe exact chunk ordering, end-of-stream sentinel behavior, error object shape, rate limits, or whether `role` is present on every streamed chunk.
- The documentation uses `chunk` and `delta` names interchangeably in examples; both are typed as `Message` in the streaming callback signature.
