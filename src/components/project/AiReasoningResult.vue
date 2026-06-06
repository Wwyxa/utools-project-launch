<script setup lang="ts">
import { computed } from "vue";
import type { AiReasoningStreamState } from "../../lib/aiReasoning";
import { renderMarkdown } from "../../lib/markdown";

const props = defineProps<{
  result: AiReasoningStreamState;
}>();

const renderedReasoning = computed(() => renderMarkdown(props.result.reasoning));
const renderedContent = computed(() => renderMarkdown(props.result.content));
const hasReasoning = computed(() => props.result.reasoning.trim().length > 0);
const hasContent = computed(() => props.result.content.trim().length > 0);
</script>

<template>
  <div class="space-y-2 pr-7">
    <details
      v-if="hasReasoning"
      class="group overflow-hidden rounded-lg border border-border-subtle bg-surface text-on-surface-variant shadow-sm"
    >
      <summary
        class="flex cursor-pointer select-none items-center justify-between gap-3 bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container"
      >
        <span>AI 思考</span>
        <span class="text-[10px] font-semibold text-on-surface-variant group-open:hidden">展开</span>
        <span class="hidden text-[10px] font-semibold text-on-surface-variant group-open:inline">收起</span>
      </summary>
      <div class="border-t border-border-subtle px-3 py-2">
        <div class="memo-rendered ai-markdown-result text-on-surface-variant" v-html="renderedReasoning"></div>
      </div>
    </details>

    <div v-if="hasContent" class="memo-rendered ai-markdown-result text-on-surface" v-html="renderedContent"></div>
  </div>
</template>
