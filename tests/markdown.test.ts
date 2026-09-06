import { describe, expect, it } from "vitest";
import { collectMarkdownImageSources, highlightCode, languageForFilePath, renderMarkdown } from "../src/lib/markdown";

describe("languageForFilePath", () => {
  it("maps supported source paths to registered highlight languages", () => {
    expect(languageForFilePath("src/components/App.vue")).toBe("xml");
    expect(languageForFilePath("src\\store\\useStore.ts")).toBe("typescript");
    expect(languageForFilePath("scripts/check.py")).toBe("python");
    expect(languageForFilePath("Dockerfile")).toBe("dockerfile");
  });

  it("returns an empty language for unsupported files", () => {
    expect(languageForFilePath("assets/icon.unknown")).toBe("");
  });
});

describe("highlightCode", () => {
  it("returns syntax token HTML for registered languages and escapes unknown content", () => {
    expect(highlightCode("const value = 1;", "typescript")).toContain("hljs-keyword");
    expect(highlightCode("<script>", "")).toBe("&lt;script&gt;");
  });
});

describe("renderMarkdown", () => {
  it("renders centered README HTML and collapsible details", () => {
    const rendered = renderMarkdown(`<p align="center">
<img src="docs/logo.png" alt="开发工作台 Logo" width="180" />
</p>

<h1 align="center">开发工作台</h1>

<p align="center">uTools Project Launch</p>

<details>
<summary>查看更多界面</summary>

内容
</details>`);

    expect(rendered).toContain('<p class="markdown-align-center">');
    expect(rendered).toContain('<img src="docs/logo.png" alt="开发工作台 Logo" width="180">');
    expect(rendered).toContain('<h1 class="markdown-align-center">开发工作台</h1>');
    expect(rendered).toContain("<details>");
    expect(rendered).toContain("<summary>查看更多界面</summary>");
    expect(rendered).not.toContain("&lt;p");
  });

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
});
