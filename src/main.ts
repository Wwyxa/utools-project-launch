import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { overlayScrollbar } from "./lib/overlayScrollbar";
import "overlayscrollbars/overlayscrollbars.css";
import "./index.css";

const rendererBootstrapStartedAt = performance.now();
const startupTiming = window.__utoolsProjectLaunchStartupTiming;

if (startupTiming) {
  startupTiming.mark = (phase, measurements = {}) => {
    console.info(
      "[utools-project-launch:startup]",
      JSON.stringify({
        phase,
        epochMs: Date.now(),
        preloadStartedAtEpochMs: startupTiming.preloadStartedAtEpochMs,
        rendererElapsedMs: Math.round((performance.now() - rendererBootstrapStartedAt) * 100) / 100,
        ...measurements,
      }),
    );
  };
  startupTiming.mark("renderer-bootstrap-start");
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => startupTiming.mark?.("renderer-post-paint"));
    });
  }
}

const app = createApp(App);
app.use(createPinia());
app.directive("overlay-scrollbar", overlayScrollbar);
app.mount("#root");
startupTiming?.mark?.("vue-mount-end");
if (startupTiming?.mark && typeof window.requestAnimationFrame === "function") {
  window.requestAnimationFrame(() => startupTiming.mark?.("renderer-first-frame"));
}
