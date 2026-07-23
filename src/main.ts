import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { overlayScrollbar } from "./lib/overlayScrollbar";
import "overlayscrollbars/overlayscrollbars.css";
import "./index.css";

const app = createApp(App);
app.use(createPinia());
app.directive("overlay-scrollbar", overlayScrollbar);
app.mount("#root");
