import { describe, expect, it } from "vitest";
import { parseGitDiff } from "./gitDiff";

describe("parseGitDiff", () => {
  it("tracks line numbers through context, deletion and addition rows", () => {
    const parsed = parseGitDiff(
      [
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -10,3 +20,3 @@ function example()",
        " unchanged",
        "-before",
        "+after",
        " trailing",
      ].join("\n"),
    );

    expect(parsed.hunks).toEqual([
      expect.objectContaining({ oldStart: 10, oldCount: 3, newStart: 20, newCount: 3, section: "function example()" }),
    ]);
    expect(parsed.rows.slice(4)).toEqual([
      expect.objectContaining({ kind: "context", content: "unchanged", oldLineNumber: 10, newLineNumber: 20 }),
      expect.objectContaining({ kind: "deletion", content: "before", oldLineNumber: 11, newLineNumber: null }),
      expect.objectContaining({ kind: "addition", content: "after", oldLineNumber: null, newLineNumber: 21 }),
      expect.objectContaining({ kind: "context", content: "trailing", oldLineNumber: 12, newLineNumber: 22 }),
    ]);
  });

  it("defaults omitted hunk counts to one and resets counters for each hunk", () => {
    const parsed = parseGitDiff(
      ["@@ -1 +1 @@", "-old", "+new", "@@ -8,0 +9,2 @@ next", "+first", "+second"].join("\n"),
    );

    expect(parsed.hunks).toEqual([
      expect.objectContaining({ id: "hunk-0", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }),
      expect.objectContaining({ id: "hunk-1", oldStart: 8, oldCount: 0, newStart: 9, newCount: 2 }),
    ]);
    expect(parsed.rows.at(-1)).toEqual(expect.objectContaining({ hunkId: "hunk-1", newLineNumber: 10 }));
  });

  it("keeps metadata, binary markers and no-newline markers visible", () => {
    const parsed = parseGitDiff(
      [
        "index 123..456 100644",
        "Binary files a/logo.png and b/logo.png differ",
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(parsed.rows.filter((row) => row.kind === "meta").map((row) => row.content)).toEqual([
      "index 123..456 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "\\ No newline at end of file",
      "\\ No newline at end of file",
    ]);
  });

  it("recognizes a second concatenated diff header after an active hunk", () => {
    const parsed = parseGitDiff(
      [
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -2 +2 @@",
        " context",
      ].join("\n"),
    );

    expect(parsed.rows.slice(3, 6).every((row) => row.kind === "meta")).toBe(true);
    expect(parsed.hunks).toHaveLength(2);
  });

  it("keeps added content beginning with two plus signs inside the active hunk", () => {
    const parsed = parseGitDiff("@@ -0,0 +1 @@\n+++ value");
    expect(parsed.rows[1]).toEqual(
      expect.objectContaining({ kind: "addition", content: "++ value", newLineNumber: 1 }),
    );
  });

  it("returns no rows for empty input and treats malformed hunk headers as metadata", () => {
    expect(parseGitDiff("")).toEqual({ rows: [], hunks: [] });

    const parsed = parseGitDiff("@@ malformed @@\n+not-a-hunk");
    expect(parsed.hunks).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({ kind: "meta", content: "@@ malformed @@" }),
      expect.objectContaining({ kind: "meta", content: "+not-a-hunk" }),
    ]);
  });
});
