// @vitest-environment happy-dom

import { createApp, h, nextTick, ref, type App } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import BaseModal from "../src/components/common/BaseModal.vue";
import ActionDialog from "../src/components/common/ActionDialog.vue";
import { requestAppEscape } from "../src/lib/escape";

vi.mock("../src/store/useStore", () => ({ useStore: () => ({ locale: "zh-CN" }) }));

let app: App | null = null;

const settleDialogs = async () => {
  await nextTick();
  await nextTick();
};

afterEach(async () => {
  app?.unmount();
  app = null;
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  document.body.innerHTML = "";
});

const dialogOrder = () => Array.from(document.querySelectorAll('[role="dialog"]'))
  .map((dialog) => dialog.querySelector("h3")?.textContent);

describe("modal stacking", () => {
  it("keeps confirmation stacking and Escape aligned regardless of template order, including reopening", async () => {
    const historyOpen = ref(true);
    const confirmationOpen = ref(false);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({
      setup: () => () => [
        h(ActionDialog, {
          open: confirmationOpen.value,
          title: "Delete history",
          message: "Delete the saved logs?",
          primaryLabel: "Delete",
          onCancel: () => { confirmationOpen.value = false; },
        }),
        h(BaseModal, {
          open: historyOpen.value,
          title: "History",
          transitionCss: false,
          onClose: () => { historyOpen.value = false; },
        }),
      ],
    });
    app.directive("overlay-scrollbar", {});
    app.mount(root);
    await settleDialogs();
    confirmationOpen.value = true;
    await settleDialogs();
    expect(dialogOrder()).toEqual(["History", "Delete history"]);

    confirmationOpen.value = false;
    await settleDialogs();
    confirmationOpen.value = true;
    await settleDialogs();
    expect(dialogOrder()).toEqual(["History", "Delete history"]);
    expect(document.activeElement?.closest('[role="dialog"]')?.textContent).toContain("Delete history");

    expect(requestAppEscape(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true);
    await settleDialogs();
    expect(confirmationOpen.value).toBe(false);
    expect(historyOpen.value).toBe(true);

    expect(requestAppEscape(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true);
    await settleDialogs();
    expect(historyOpen.value).toBe(false);
  });
});