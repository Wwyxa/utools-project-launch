import { describe, expect, it } from "vitest";
import {
  findGitDiffChangeBlocks,
  findGitDiffInlineRanges,
  markGitDiffInlineRanges,
  parseGitDiff,
  toGitDiffSideBySideRows,
} from "../src/lib/gitDiff";

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

  it("projects change blocks into aligned old and new rows", () => {
    const parsed = parseGitDiff(
      [
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,4 +1,3 @@",
        " context",
        "-old one",
        "-old two",
        "+new one",
        " next",
      ].join("\n"),
    );

    const rows = toGitDiffSideBySideRows(parsed.rows);
    expect(rows.filter((row) => row.kind === "change")).toEqual([
      expect.objectContaining({
        oldRow: expect.objectContaining({ kind: "deletion", content: "old one", oldLineNumber: 2 }),
        newRow: expect.objectContaining({ kind: "addition", content: "new one", newLineNumber: 2 }),
      }),
      expect.objectContaining({
        oldRow: expect.objectContaining({ kind: "deletion", content: "old two", oldLineNumber: 3 }),
        newRow: null,
      }),
    ]);

    expect(rows.filter((row) => row.kind === "context")).toHaveLength(2);
    expect(rows.filter((row) => row.kind === "hunk")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "change").every((row) => !row.isReliablePair)).toBe(true);
    expect(rows.filter((row) => row.kind === "meta").map((row) => row.oldRow?.content)).toEqual([
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
    ]);
  });

  it("pads either side and does not pair changes across hunk boundaries", () => {
    const parsed = parseGitDiff(
      [
        "@@ -1,2 +1,4 @@ first",
        " context",
        "+new one",
        "+new two",
        "@@ -8,3 +10,1 @@ second",
        "-old one",
        "-old two",
        " context",
      ].join("\n"),
    );

    const rows = toGitDiffSideBySideRows(parsed.rows);
    expect(rows.filter((row) => row.kind === "change")).toEqual([
      expect.objectContaining({
        oldRow: null,
        newRow: expect.objectContaining({ kind: "addition", content: "new one", newLineNumber: 2 }),
      }),
      expect.objectContaining({
        oldRow: null,
        newRow: expect.objectContaining({ kind: "addition", content: "new two", newLineNumber: 3 }),
      }),
      expect.objectContaining({
        oldRow: expect.objectContaining({ kind: "deletion", content: "old one", oldLineNumber: 8 }),
        newRow: null,
      }),
      expect.objectContaining({
        oldRow: expect.objectContaining({ kind: "deletion", content: "old two", oldLineNumber: 9 }),
        newRow: null,
      }),
    ]);
    expect(rows.filter((row) => row.kind === "hunk").map((row) => row.oldRow?.hunkId)).toEqual(["hunk-0", "hunk-1"]);
    expect(rows.filter((row) => row.kind === "context")).toHaveLength(2);
  });

  it("finds separate navigation blocks inside one full-file hunk", () => {
    const parsed = parseGitDiff(
      [
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,12 +1,12 @@",
        " context before first change",
        "-old first value",
        "+new first value",
        " context between changes one",
        " context between changes two",
        "-old second value",
        "+new second value",
        " context after second change",
      ].join("\n"),
    );

    expect(parsed.hunks).toHaveLength(1);
    expect(findGitDiffChangeBlocks(parsed.rows)).toEqual([
      { id: "change-block-0", startRowIndex: 5, endRowIndex: 6 },
      { id: "change-block-1", startRowIndex: 9, endRowIndex: 10 },
    ]);
  });
});

describe("inline Git diff ranges", () => {
  it("marks only the changed character and word ranges in a reliable replacement", () => {
    expect(findGitDiffInlineRanges("const oldValue = 1;", "const newValue = 2;")).toEqual({
      oldRanges: [
        { start: 6, end: 9 },
        { start: 17, end: 18 },
      ],
      newRanges: [
        { start: 6, end: 9 },
        { start: 17, end: 18 },
      ],
    });
  });

  it("marks a character inserted on only one side of a reliable replacement", () => {
    expect(findGitDiffInlineRanges("feature", "feature!")).toEqual({
      oldRanges: [],
      newRanges: [{ start: 7, end: 8 }],
    });
  });

  it("skips long or fragmented replacements that cannot be highlighted conservatively", () => {
    expect(findGitDiffInlineRanges("x".repeat(1025), "y".repeat(1025))).toBeNull();
    expect(findGitDiffInlineRanges("a|b|c|d|e", "A|B|C|D|E")).toBeNull();
  });

  it("preserves syntax tags and escaped text when adding inline marks", () => {
    expect(
      markGitDiffInlineRanges('<span class="hljs-string">&quot;old&quot;</span>', [{ start: 1, end: 4 }], "deletion"),
    ).toBe('<span class="hljs-string">&quot;<mark class="diff-inline-deletion">old</mark>&quot;</span>');
    expect(
      markGitDiffInlineRanges('<span class="hljs-keyword">const</span> value', [{ start: 3, end: 9 }], "addition"),
    ).toBe(
      '<span class="hljs-keyword">con<mark class="diff-inline-addition">st</mark></span><mark class="diff-inline-addition"> val</mark>ue',
    );
  });
});
