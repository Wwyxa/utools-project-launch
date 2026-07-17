import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = await createServer({ root: repoRoot, server: { middlewareMode: true }, appType: "custom" });

try {
  const { classifyProjectMarkdownImageSource } = await server.ssrLoadModule("/src/lib/projectMarkdown.ts");
  const { collectMarkdownImageSources, renderMarkdown } = await server.ssrLoadModule("/src/lib/markdown.ts");

  assert.deepEqual(classifyProjectMarkdownImageSource("docs/screenshots/Git状态.png", "README.md"), {
    kind: "local",
    relativePath: "docs/screenshots/Git状态.png",
  });
  assert.deepEqual(classifyProjectMarkdownImageSource("image.png", "docs/guide/readme.md"), {
    kind: "local",
    relativePath: "docs/guide/image.png",
  });
  assert.deepEqual(classifyProjectMarkdownImageSource("./image.png", "docs/guide/readme.md"), {
    kind: "local",
    relativePath: "docs/guide/image.png",
  });
  assert.deepEqual(classifyProjectMarkdownImageSource("../image.png", "docs/guide/readme.md"), {
    kind: "local",
    relativePath: "docs/image.png",
  });
  assert.deepEqual(classifyProjectMarkdownImageSource("/assets/image.png", "docs/guide/readme.md"), {
    kind: "local",
    relativePath: "assets/image.png",
  });
  assert.deepEqual(classifyProjectMarkdownImageSource("../%E6%88%AA%E5%9B%BE.png?raw=1#preview", "docs/guide.md"), {
    kind: "local",
    relativePath: "截图.png",
  });

  for (const source of [
    "../../outside.png",
    "C:/outside.png",
    "\\\\server\\share\\image.png",
    "file:///tmp/a.png",
    "%E0%A4%A",
    "image%00.png",
  ]) {
    assert.equal(classifyProjectMarkdownImageSource(source, "README.md").kind, "blocked", source);
  }
  for (const source of [
    "https://example.com/a.png",
    "http://example.com/a.png",
    "//cdn.example.com/a.png",
    "data:image/png;base64,AA==",
    "blob:https://example.com/id",
    "#diagram",
  ]) {
    assert.deepEqual(classifyProjectMarkdownImageSource(source, "README.md"), { kind: "external", source });
  }

  const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
  const readmeImagePaths = collectMarkdownImageSources(readme)
    .map((source) => classifyProjectMarkdownImageSource(source, "README.md"))
    .filter((result) => result.kind === "local")
    .map((result) => result.relativePath);
  assert.ok(readmeImagePaths.includes("docs/screenshots/Git状态.png"));
  assert.deepEqual(collectMarkdownImageSources("![real](real.png)\n\n```md\n![sample](ignored.png)\n```"), [
    "real.png",
  ]);

  const frontMatterDocument = `---
name: trellis-check
description: |
  Code quality check expert. Reviews code changes against specs and self-fixes issues.
tools: Read, Write, Edit, Bash, Glob, Grep
---
# Check Agent

You are the Check Agent in the Trellis workflow.

## Recursion Guard

You are already the \`trellis-check\` sub-agent.

- Do NOT spawn another agent.`;
  const renderedFrontMatterDocument = renderMarkdown(frontMatterDocument);
  assert.match(renderedFrontMatterDocument, /markdown-front-matter/);
  assert.match(renderedFrontMatterDocument, /hljs-attr[^>]*>name:<\/span>/);
  assert.match(renderedFrontMatterDocument, /<h1>Check Agent<\/h1>/);
  assert.match(renderedFrontMatterDocument, /<h2>Recursion Guard<\/h2>/);
  assert.match(renderedFrontMatterDocument, /<code>trellis-check<\/code>/);
  assert.match(renderedFrontMatterDocument, /<li>Do NOT spawn another agent\.<\/li>/);
  assert.doesNotMatch(renderedFrontMatterDocument, /<hr>/);
  assert.match(renderMarkdown("---\n\n# Ordinary divider"), /<hr>/);
  assert.deepEqual(
    collectMarkdownImageSources("---\nname: sample\ncover: '![ignored](ignored.png)'\n---\n![real](real.png)"),
    ["real.png"],
  );

  const content = "Before ![ready](ready.png) middle ![loading](loading.png) after ![failed](failed.png) end";
  const rendered = renderMarkdown(content, {
    imageFallbackText: "Local image unavailable",
    resolveImage: (source) => {
      if (source === "ready.png") return { status: "ready", src: "data:image/png;base64,AA==" };
      if (source === "loading.png") return { status: "loading", message: "Loading local image" };
      return { status: "failed" };
    },
  });
  assert.match(rendered, /src="data:image\/png;base64,AA=="/);
  assert.match(rendered, /markdown-image-fallback-loading/);
  assert.match(rendered, /Loading local image/);
  assert.match(rendered, /markdown-image-fallback-failed/);
  assert.match(rendered, /Before/);
  assert.match(rendered, /middle/);
  assert.match(rendered, /after/);
  assert.match(rendered, /end/);

  const defaultRendered = renderMarkdown("![remote](https://example.com/a.png)");
  assert.match(defaultRendered, /src="https:\/\/example.com\/a.png"/);
} finally {
  await server.close();
}
