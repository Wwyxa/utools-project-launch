import type { AppStore, AiStreamHandlers } from "../appStoreShape";
import type { AiPreferences, AiPromptMode, AiAnalyzeResult } from "../../types";
import { bridge } from "../helpers/bridge";
import { createAiPromptModeId } from "../helpers/projectHelpers";
import { DEFAULT_AI_PROMPT_MODES } from "../../types";
import { aiStreamChunkRawText } from "../../lib/aiReasoning";

export const aiActions = {
  setAiPreferences(this: AppStore, patch: Partial<AiPreferences>) {
    this.aiPreferences = { ...this.aiPreferences, ...patch };
    bridge.saveAiPreferences(this.aiPreferences);
  },

  addAiPromptMode(this: AppStore) {
    const id = createAiPromptModeId();
    const nextMode: AiPromptMode = {
      id,
      name: "自定义模式",
      prompt: "请基于以下 Git 信息输出面向开发者的结构化内容。",
      builtIn: false,
      kind: "git-analysis",
    };
    this.aiPreferences = { ...this.aiPreferences, modes: [...this.aiPreferences.modes, nextMode] };
    bridge.saveAiPreferences(this.aiPreferences);
    return id;
  },

  updateAiPromptMode(this: AppStore, modeId: string, patch: Partial<Pick<AiPromptMode, "name" | "prompt">>) {
    const modes = this.aiPreferences.modes.map((mode) =>
      mode.id === modeId
        ? {
          ...mode,
          name: typeof patch.name === "string" ? patch.name : mode.name,
          prompt: typeof patch.prompt === "string" ? patch.prompt : mode.prompt,
        }
        : mode,
    );
    this.aiPreferences = { ...this.aiPreferences, modes };
    bridge.saveAiPreferences(this.aiPreferences);
  },

  deleteAiPromptMode(this: AppStore, modeId: string) {
    const modes = this.aiPreferences.modes.filter((mode) => mode.builtIn || mode.id !== modeId);
    this.aiPreferences = {
      ...this.aiPreferences,
      modes: modes.length > 0 ? modes : DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
    };
    bridge.saveAiPreferences(this.aiPreferences);
  },

  resetAiPromptModes(this: AppStore) {
    this.aiPreferences = {
      ...this.aiPreferences,
      modes: DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
    };
    bridge.saveAiPreferences(this.aiPreferences);
  },

  async refreshAiModels(this: AppStore) {
    this.aiModelRefreshing = true;
    this.aiModelRefreshMessage = "";
    try {
      this.aiModels = await bridge.listAiModels({ ...this.aiPreferences });
      if (
        this.aiPreferences.provider === "utools" &&
        this.aiPreferences.model &&
        !this.aiModels.some(
          (model) => model.id === this.aiPreferences.model || model.name === this.aiPreferences.model,
        )
      ) {
        this.aiModelRefreshMessage = "当前配置的 uTools 模型未在可用列表中找到，建议重新选择。";
      }
      if (this.aiPreferences.provider !== "utools" && this.aiModels.length === 0) {
        this.aiModelRefreshMessage = "未从当前供应商获取到模型，可手动填写模型 ID。";
      }
    } catch (error) {
      this.aiModels = [];
      this.aiModelRefreshMessage = error instanceof Error ? error.message : "获取模型列表失败。";
    } finally {
      this.aiModelRefreshing = false;
    }
  },

  async testAiConfiguration(this: AppStore) {
    this.aiModelTesting = true;
    this.aiModelTestMessage = "";
    this.aiModelTestOk = null;
    try {
      const result = await bridge.testAiConnection({ ...this.aiPreferences });
      this.aiModelTestOk = result.ok;
      this.aiModelTestMessage = result.ok
        ? result.message || "AI 连接测试成功。"
        : result.message || "AI 连接测试失败。";
      return result;
    } catch (error) {
      const result = { ok: false, message: error instanceof Error ? error.message : "AI 连接测试失败。" };
      this.aiModelTestOk = false;
      this.aiModelTestMessage = result.message;
      return result;
    } finally {
      this.aiModelTesting = false;
    }
  },

  async analyzeGitWithAiStream(this: AppStore,
    projectId: string,
    prompt: string,
    handlers: AiStreamHandlers = {},
  ): Promise<AiAnalyzeResult> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      const result: AiAnalyzeResult = { ok: false, content: "", message: "项目不存在，无法进行 AI 分析。" };
      handlers.onDone?.(result);
      return result;
    }
    let finalResult: AiAnalyzeResult | undefined;
    let completed = false;
    const complete = (result: AiAnalyzeResult) => {
      if (completed) return;
      completed = true;
      finalResult = result;
      handlers.onDone?.(result);
    };
    try {
      handlers.onStart?.();
      await bridge.analyzeWithAiStream(
        { preferences: { ...this.aiPreferences }, prompt },
        (chunk) => {
          handlers.onChunk?.(chunk);
        },
        (result) => {
          complete(result);
        },
      );
      if (!completed) {
        complete({ ok: false, content: "", message: "AI 流式响应未返回完成结果。" });
      }
    } catch (error) {
      if (!completed) {
        complete({
          ok: false,
          content: "",
          message: error instanceof Error ? error.message : "AI 分析失败。",
        });
      }
    }
    return finalResult!;
  },

  async analyzeGitWithAi(this: AppStore, projectId: string, prompt: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    this.aiAnalyzing = true;
    this.aiAnalysisMessage = "";
    this.aiAnalysisResult = "";
    this.aiAnalysisState = "loading";
    try {
      await this.analyzeGitWithAiStream(projectId, prompt, {
        onChunk: (chunk) => {
          this.aiAnalysisResult += aiStreamChunkRawText(chunk);
        },
        onDone: (result) => {
          if (!this.aiAnalysisResult && result.content) {
            this.aiAnalysisResult = result.content;
          }
          this.aiAnalysisMessage = result.ok ? result.message || "" : result.message || "AI analysis failed";
          this.aiAnalysisState = result.ok ? (this.aiAnalysisResult ? "success" : "warning") : "error";
          if (!result.ok && !this.aiAnalysisMessage) {
            this.aiAnalysisMessage = "AI 分析失败。";
          }
          if (result.ok && !this.aiAnalysisResult) {
            this.aiAnalysisMessage = "AI 已返回成功，但没有生成内容。";
          }
        },
      });
    } finally {
      this.aiAnalyzing = false;
    }
  }
};
