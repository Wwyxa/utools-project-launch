// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as escape from "../src/lib/escape";

const mounted: Vue.App[] = [];
const transpile = (source: string) =>
  transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;

function mountTerminal(historyOnly: boolean) {
  const translations: Record<string, unknown> = {};
  runInNewContext(transpile(readFileSync("src/lib/i18n.ts", "utf8") + "\nexport const translations = messages;"), {
    exports: translations,
    require: () => ({}),
  });
  const icon = { render: () => null };
  const imports: Record<string, unknown> = {
    vue: Vue,
    "lucide-vue-next": new Proxy({}, { get: () => icon }),
    "../../store/useStore": {
      useStore: () => ({ scriptLogs: {}, supportsBridge: true, listRuntimeRecords: vi.fn().mockResolvedValue([]) }),
    },
    "../../lib/i18n": { useI18n: () => Vue.ref((translations.translations as Record<string, unknown>)["zh-CN"]) },
    "../../lib/escape": escape,
    "../../lib/overlayScrollbar": { getOverlayScrollbarScrollElements: () => null },
    "../../lib/utils": { cn: (...classes: string[]) => classes.filter(Boolean).join(" ") },
    "../common/ActionDialog.vue": { default: icon },
    // BaseModal 桩：历史对话框（含来源下拉）在弹窗内，须渲染插槽供测试触达
    "../common/BaseModal.vue": {
      default: { template: '<div><slot name="header" /><slot /><slot name="footer" /><slot name="footerLeft" /></div>' },
    },
    "../common/UiContextMenu.vue": { default: icon },
    "../common/uiContextMenu": {},
    "../common/actionStatus": { showActionStatus: vi.fn() },
  };
  const descriptor = parse(readFileSync("src/components/terminal/Terminal.vue", "utf8")).descriptor;
  const script = compileScript(descriptor, { id: "runtime-history-test", inlineTemplate: true });
  const exports: { default?: Vue.Component } = {};
  runInNewContext(transpile(script.content), {
    exports,
    require: (name: string) => imports[name] ?? {},
    window,
    document,
  });
  const app = Vue.createApp(exports.default!, { projectId: "project", historyOnly });
  app.directive("overlay-scrollbar", {});
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  mounted.push(app);
  return root;
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.innerHTML = "";
});

describe("runtime history interface", () => {
  it("selects a themed source option with the keyboard and dismisses it on outside click", async () => {
    const root = mountTerminal(true);
    root.querySelector<HTMLButtonElement>("button")!.click();
    await Vue.nextTick();
    await Vue.nextTick();
    expect(document.querySelector("select")).toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    trigger.click();
    await Vue.nextTick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="listbox"]')?.classList.contains("bg-surface-container-lowest")).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("直接运行");
    expect(document.activeElement?.isConnected).toBe(true);
    await Vue.nextTick();
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    (document.activeElement as HTMLButtonElement).click();
    await Vue.nextTick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(trigger.textContent).toContain("直接运行");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    await Vue.nextTick();
    document.body.click();
    await Vue.nextTick();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
