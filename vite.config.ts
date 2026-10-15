import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { readFile, readdir } from "node:fs/promises";
import path from "path";
import { transformWithEsbuild } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(() => {
  return {
    base: "./",
    plugins: [
      vue(),
      tailwindcss(),
      {
        name: "minify-preload",
        apply: "build",
        async generateBundle() {
          const publicRoot = path.resolve(__dirname, "public");
          const moduleFiles = await readdir(path.join(publicRoot, "preload"));
          const files = [
            "preload.js",
            ...moduleFiles.filter((file) => file.endsWith(".js")).map((file) => `preload/${file}`),
          ];
          await Promise.all(
            files.map(async (file) => {
              const source = await readFile(path.join(publicRoot, file), "utf8");
              const result = await transformWithEsbuild(source, file, {
                loader: "js",
                minifyWhitespace: true,
                minifySyntax: true,
                minifyIdentifiers: false,
                legalComments: "none",
                sourcemap: false,
              });
              this.emitFile({ type: "asset", fileName: file, source: result.code });
            }),
          );
        },
      },
    ],
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
      include: ["tests/**/*.test.ts"],
      exclude: [...configDefaults.exclude, "**/references/**"],
    },
  };
});
