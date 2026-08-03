import { describe, expect, it } from "vitest";
import { highlightCode, languageForFilePath } from "./markdown";

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
