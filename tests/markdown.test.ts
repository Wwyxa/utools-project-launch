import { describe, expect, it } from "vitest";
import { collectMarkdownImageSources, highlightCode, renderMarkdown } from "../src/lib/markdown";

describe("highlightCode", () => {
  it("returns syntax token HTML for registered languages and escapes unknown content", () => {
    expect(highlightCode("const value = 1;", "typescript")).toContain("hljs-keyword");
    expect(highlightCode("<script>", "")).toBe("&lt;script&gt;");
  });
});

describe("renderMarkdown", () => {
  it("resolves raw HTML images through the existing image pipeline", () => {
    const rendered = renderMarkdown('<p><img src="docs/logo.png" alt="Logo" /></p>', {
      resolveImage: (source) =>
        source === "docs/logo.png" ? { status: "ready", src: "data:image/png;base64,abc" } : undefined,
    });

    expect(rendered).toContain('src="data:image/png;base64,abc"');
    expect(collectMarkdownImageSources('<p><img src="docs/logo.png" /></p>')).toEqual(["docs/logo.png"]);
  });

  it("filters unsafe raw HTML while keeping the supported text", () => {
    const rendered = renderMarkdown(
      '<script>alert("xss")</script><p onclick="alert(1)">安全内容</p><img src="javascript:alert(1)">',
    );

    expect(rendered).toContain("安全内容");
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("onclick");
    expect(rendered).not.toContain("javascript:");
  });

  it("renders GitHub task checkboxes with source-order indexes, skipping fenced markers", () => {
    const rendered = renderMarkdown(["- [ ] Bug fix", "- [x] Feature", "```md", "- [ ] fenced", "```"].join("\n"));
    expect(rendered).toContain('data-task-index="0"');
    expect(rendered).toContain('data-task-index="1" checked');
    expect(rendered).toContain("disabled");
    expect(rendered.match(/markdown-task-checkbox/g)?.length).toBe(2);
  });

  it("renders interactive checkboxes when interactiveTasks is enabled", () => {
    const rendered = renderMarkdown("- [x] done", { interactiveTasks: true });
    expect(rendered).toContain('data-task-index="0" checked');
    expect(rendered).not.toContain("disabled");
  });
});
