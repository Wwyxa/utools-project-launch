import { createApp, defineComponent, h, ref } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import StartupGate from "./components/common/StartupGate.vue";
import { STARTUP_PREFLIGHT_KEY } from "./lib/startupPreflight";
import { getProjectBridge } from "./lib/projectBridge";
import { observeOverlayScrollbars, overlayScrollbar } from "./lib/overlayScrollbar";
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

// The startup gate must run before the Pinia store is created: store creation
// synchronously reads preferences from the plugin local data directory, which
// is only valid once the v8 preflight allows startup.
const preflightResult = getProjectBridge().preflightStartup();
const startupBlocked = ref(["upgrade-required", "migration-required", "migration-incomplete"].includes(
  preflightResult.status,
));

const app = createApp(defineComponent({
  setup() {
    return () => startupBlocked.value
      ? h(StartupGate, { onReady: () => { startupBlocked.value = false; } })
      : h(App);
  },
}));
app.provide(STARTUP_PREFLIGHT_KEY, preflightResult);
app.use(createPinia());
app.directive("overlay-scrollbar", overlayScrollbar);
app.mount("#root");
const stopOverlayScrollbars = observeOverlayScrollbars();
app.onUnmount(stopOverlayScrollbars);
startupTiming?.mark?.("vue-mount-end");
if (startupTiming?.mark && typeof window.requestAnimationFrame === "function") {
  window.requestAnimationFrame(() => startupTiming.mark?.("renderer-first-frame"));
}
