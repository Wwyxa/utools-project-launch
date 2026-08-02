import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(() => {
  return {
    base: "./",
    plugins: [vue(), tailwindcss()],
    define: {
      "process.env": JSON.stringify({}),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
    test: {
      exclude: [...configDefaults.exclude, "**/references/**"],
    },
  };
});
