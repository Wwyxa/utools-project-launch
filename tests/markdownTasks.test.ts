import { describe, expect, it } from "vitest";
import { toggleMarkdownTaskAt } from "../src/lib/markdownTasks";

describe("toggleMarkdownTaskAt", () => {
  it("flips the nth task in document order, preserving indentation and markers", () => {
    expect(toggleMarkdownTaskAt("- [ ] a\n- [x] b\n- [ ] c", 1)).toBe("- [ ] a\n- [ ] b\n- [ ] c");
    expect(toggleMarkdownTaskAt("  * [x] nested", 0)).toBe("  * [ ] nested");
    expect(toggleMarkdownTaskAt("3. [ ] ordered", 0)).toBe("3. [x] ordered");
  });

  it("skips fenced markers when indexing", () => {
    const source = ["- [ ] first", "```", "- [ ] fenced", "```", "- [ ] second"].join("\n");
    expect(toggleMarkdownTaskAt(source, 1)).toBe(["- [ ] first", "```", "- [ ] fenced", "```", "- [x] second"].join("\n"));
  });

  it("returns the source unchanged for out-of-range indexes or missing tasks", () => {
    expect(toggleMarkdownTaskAt("- [ ] only", -1)).toBe("- [ ] only");
    expect(toggleMarkdownTaskAt("- [ ] only", 1)).toBe("- [ ] only");
    expect(toggleMarkdownTaskAt("no tasks", 0)).toBe("no tasks");
  });
});
