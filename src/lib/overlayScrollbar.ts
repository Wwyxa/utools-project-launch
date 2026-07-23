import type { Directive } from "vue";
import {
  ClickScrollPlugin,
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
} from "overlayscrollbars";

const instances = new WeakMap<HTMLElement, OverlayScrollbarsInstance>();

OverlayScrollbars.plugin(ClickScrollPlugin);

export const overlayScrollbar: Directive<HTMLElement> = {
  beforeMount(element) {
    element.setAttribute("data-overlayscrollbars-initialize", "");
  },
  mounted(element) {
    instances.set(
      element,
      OverlayScrollbars(element, {
        scrollbars: {
          theme: "os-theme-utools",
          autoHide: "leave",
          autoHideDelay: 400,
          autoHideSuspend: true,
          clickScroll: true,
        },
      }),
    );
  },
  updated(element) {
    instances.get(element)?.update();
  },
  unmounted(element) {
    instances.get(element)?.destroy();
    instances.delete(element);
  },
};
