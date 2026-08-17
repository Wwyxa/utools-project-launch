function normalizeAiModelCollection(models, providerHint) {
  return Array.isArray(models)
    ? models
        .map((model) => ({
          id: String(model.id || model.model || model.name || model.label || "").trim(),
          name: String(model.name || model.label || model.model || model.id || "").trim(),
          provider: String(model.provider || providerHint || "").trim() || undefined,
        }))
        .filter((model) => Boolean(model.id || model.name))
    : [];
}

function normalizeAiBaseUrl(preferences) {
  return String(preferences.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

function getAiHeaders(preferences) {
  if (preferences.provider === "anthropic-compatible") {
    return {
      "content-type": "application/json",
      "x-api-key": preferences.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${preferences.apiKey}`,
  };
}

function extractAiErrorMessage(data, fallback) {
  return (
    data?.error?.message ||
    data?.error?.error?.message ||
    data?.message ||
    data?.detail ||
    data?.type ||
    fallback ||
    "AI 请求失败。"
  );
}

async function parseAiHttpError(response) {
  const data = await response.json().catch(() => ({}));
  return extractAiErrorMessage(data, response.statusText || `HTTP ${response.status}`);
}

async function listAiModels(preferences) {
  const normalized = normalizeAiPreferences(preferences || readAiPreferences());
  if (normalized.provider === "utools") {
    if (!window.utools?.allAiModels) {
      return [];
    }
    return normalizeAiModelCollection(await window.utools.allAiModels(), "utools");
  }

  const baseUrl = normalizeAiBaseUrl(normalized);
  if (!baseUrl || !normalized.apiKey.trim()) {
    return [];
  }

  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: getAiHeaders(normalized),
  });
  if (!response.ok) {
    throw new Error(await parseAiHttpError(response));
  }
  const data = await response.json().catch(() => ({}));
  return normalizeAiModelCollection(data?.data || data?.models || data, normalized.provider);
}

async function testAiConnection(preferences) {
  const normalized = normalizeAiPreferences(preferences || readAiPreferences());
  try {
    if (normalized.provider === "utools") {
      if (!normalized.model.trim()) {
        return { ok: false, message: "请先选择一个 uTools 内置 AI 模型。" };
      }
      if (!window.utools?.ai) {
        return { ok: false, message: "当前 uTools 版本不支持内置 AI 请求。" };
      }
      const result = await window.utools.ai({
        model: normalized.model,
        messages: [{ role: "user", content: "ping" }],
      });
      const content = String(result?.content || result?.text || result || "").trim();
      return {
        ok: true,
        message: content
          ? "uTools 内置 AI 连接测试成功，模型已返回响应。"
          : "uTools 内置 AI 连接成功，但模型返回为空。",
      };
    }

    if (!normalized.baseUrl.trim() || !normalized.model.trim() || !normalized.apiKey.trim()) {
      return { ok: false, message: "第三方 AI 配置不完整，无法测试。" };
    }

    const baseUrl = normalizeAiBaseUrl(normalized);
    const response = await fetch(
      `${baseUrl}${normalized.provider === "anthropic-compatible" ? "/messages" : "/chat/completions"}`,
      {
        method: "POST",
        headers: getAiHeaders(normalized),
        body:
          normalized.provider === "anthropic-compatible"
            ? JSON.stringify({ model: normalized.model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] })
            : JSON.stringify({ model: normalized.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractAiErrorMessage(data, response.statusText || "AI 连接测试失败。"));
    }
    const content =
      normalized.provider === "anthropic-compatible"
        ? Array.isArray(data.content)
          ? data.content.map((part) => part.text || "").join("")
          : ""
        : String(data?.choices?.[0]?.message?.content || "");
    return { ok: true, message: content ? "AI 连接测试成功，模型已返回响应。" : "AI 连接成功，但模型返回为空。" };
  } catch (error) {
    return { ok: false, message: error?.message || "AI 连接测试失败。" };
  }
}

async function callThirdPartyAi(preferences, prompt) {
  const baseUrl = normalizeAiBaseUrl(preferences);
  if (preferences.provider === "anthropic-compatible") {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: getAiHeaders(preferences),
      body: JSON.stringify({
        model: preferences.model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(extractAiErrorMessage(data, response.statusText));
    return Array.isArray(data.content)
      ? data.content
          .map((part) => part.text || "")
          .join("\n")
          .trim()
      : "";
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getAiHeaders(preferences),
    body: JSON.stringify({ model: preferences.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractAiErrorMessage(data, response.statusText));
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

function aiText(value) {
  return typeof value === "string" ? value : "";
}

function compactAiStreamChunk(chunk) {
  if (typeof chunk === "string") {
    return { content: chunk, reasoning: "", rawContent: chunk };
  }
  const content = aiText(chunk?.content);
  const reasoning = aiText(chunk?.reasoning);
  const rawContent = aiText(chunk?.rawContent) || `${reasoning}${content}`;
  return { content, reasoning, rawContent };
}

function extractOpenAiStreamDelta(data) {
  if (data?.error) {
    throw new Error(extractAiErrorMessage(data, "OpenAI 兼容流式响应失败。"));
  }
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || {};
  const content = aiText(delta.content) || aiText(choice.text);
  const reasoning = [delta.reasoning_content, delta.reasoning, delta.thinking].map(aiText).filter(Boolean).join("");
  return compactAiStreamChunk({ content, reasoning });
}

function extractAnthropicStreamDelta(data) {
  if (data?.type === "error" || data?.error) {
    throw new Error(extractAiErrorMessage(data, "Anthropic 兼容流式响应失败。"));
  }
  if (data?.type === "content_block_delta") {
    const delta = data?.delta || {};
    return compactAiStreamChunk({
      content: aiText(delta.text),
      reasoning: aiText(delta.thinking),
    });
  }
  if (data?.type === "content_block_start") {
    const contentBlock = data?.content_block || {};
    return compactAiStreamChunk({
      content: aiText(contentBlock.text),
      reasoning: aiText(contentBlock.thinking),
    });
  }
  return compactAiStreamChunk({});
}

async function readSseStream(response, extractDelta, onChunk) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("当前运行环境不支持 AI 流式响应。");
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let rawContent = "";

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }
    try {
      const streamChunk = compactAiStreamChunk(extractDelta(JSON.parse(payload)));
      if (streamChunk.content || streamChunk.reasoning || streamChunk.rawContent) {
        content += streamChunk.content;
        reasoning += streamChunk.reasoning;
        rawContent += streamChunk.rawContent;
        onChunk?.(streamChunk);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeLine(buffer);
  }

  return { content: content.trim(), reasoning: reasoning.trim(), rawContent: rawContent.trim() };
}

async function callThirdPartyAiStream(preferences, prompt, onChunk) {
  const baseUrl = normalizeAiBaseUrl(preferences);
  if (preferences.provider === "anthropic-compatible") {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: getAiHeaders(preferences),
      body: JSON.stringify({
        model: preferences.model,
        max_tokens: 1200,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(await parseAiHttpError(response));
    }
    return readSseStream(response, extractAnthropicStreamDelta, onChunk);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getAiHeaders(preferences),
    body: JSON.stringify({
      model: preferences.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      stream: true,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseAiHttpError(response));
  }
  return readSseStream(response, extractOpenAiStreamDelta, onChunk);
}

async function analyzeWithAi(payload) {
  const preferences = normalizeAiPreferences(payload?.preferences || readAiPreferences());
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) return { ok: false, content: "", message: "AI 分析内容为空。" };
  try {
    if (preferences.provider === "utools") {
      if (!window.utools?.ai) return { ok: false, content: "", message: "当前 uTools 版本不支持内置 AI。" };
      const result = await window.utools.ai({
        model: preferences.model || undefined,
        messages: [{ role: "user", content: prompt }],
      });
      return { ok: true, content: String(result?.content || result?.text || result || "").trim() };
    }
    if (!preferences.baseUrl.trim() || !preferences.model.trim() || !preferences.apiKey.trim()) {
      return { ok: false, content: "", message: "第三方 AI 配置不完整。" };
    }
    return { ok: true, content: await callThirdPartyAi(preferences, prompt) };
  } catch (error) {
    return { ok: false, content: "", message: error?.message || "AI 分析失败。" };
  }
}

async function analyzeWithAiStream(payload, onChunk, onDone) {
  const preferences = normalizeAiPreferences(payload?.preferences || readAiPreferences());
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  const done = typeof onDone === "function" ? onDone : () => undefined;
  const chunk = typeof onChunk === "function" ? onChunk : () => undefined;
  if (!prompt) {
    done({ ok: false, content: "", message: "AI 分析内容为空。" });
    return;
  }
  try {
    if (preferences.provider === "utools") {
      if (!window.utools?.ai) {
        done({ ok: false, content: "", message: "当前 uTools 版本不支持内置 AI。" });
        return;
      }
      let content = "";
      let reasoning = "";
      let rawContent = "";
      await window.utools.ai(
        {
          model: preferences.model || undefined,
          messages: [{ role: "user", content: prompt }],
        },
        (delta) => {
          const streamChunk =
            typeof delta === "string"
              ? compactAiStreamChunk({ content: delta })
              : compactAiStreamChunk({
                  content: aiText(delta?.content) || aiText(delta?.text),
                  reasoning: aiText(delta?.reasoning_content) || aiText(delta?.reasoning) || aiText(delta?.thinking),
                });
          if (streamChunk.content || streamChunk.reasoning || streamChunk.rawContent) {
            content += streamChunk.content;
            reasoning += streamChunk.reasoning;
            rawContent += streamChunk.rawContent;
            chunk(streamChunk);
          }
        },
      );
      done({ ok: true, content: content.trim(), reasoning: reasoning.trim(), rawContent: rawContent.trim() });
      return;
    }
    if (!preferences.baseUrl.trim() || !preferences.model.trim() || !preferences.apiKey.trim()) {
      done({ ok: false, content: "", message: "第三方 AI 配置不完整。" });
      return;
    }
    const result = await callThirdPartyAiStream(preferences, prompt, chunk);
    done({ ok: true, ...result });
  } catch (error) {
    done({ ok: false, content: "", message: error?.message || "AI 分析失败。" });
  }
}

