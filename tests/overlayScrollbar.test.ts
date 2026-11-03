// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, withDirectives, type App } from "vue";
import { getOverlayScrollbarScrollElements, overlayScrollbar } from "../src/lib/overlayScrollbar";

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

it("keeps conditionally added fields inside the scrolling viewport", async () => {
  const annotated = ref(false);
  const container = document.createElement("div");
  document.body.append(container);
  app = createApp({
    render: () => withDirectives(h("div", [
      h("input", { "aria-label": "标签名称" }),
      annotated.value ? h("textarea", { "aria-label": "标签说明" }) : null,
    ]), [[overlayScrollbar]]),
  });
  app.mount(container);
  const body = container.firstElementChild as HTMLElement;
  const viewport = getOverlayScrollbarScrollElements(body)!.scrollOffsetElement;

  annotated.value = true;
  await nextTick();
  const message = body.querySelector("textarea");
  expect(message).not.toBeNull();
  expect(viewport.contains(message)).toBe(true);

  annotated.value = false;
  await nextTick();
  expect(body.querySelector("textarea")).toBeNull();
});
