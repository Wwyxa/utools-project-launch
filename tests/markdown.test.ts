import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {

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
