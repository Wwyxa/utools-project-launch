import { describe, expect, it } from "vitest";
import { findGitDiffChangeBlocks, parseGitDiff, toGitDiffSideBySideRows } from "../src/lib/gitDiff";

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

  it("returns no rows for empty input and treats malformed hunk headers as metadata", () => {
    expect(parseGitDiff("")).toEqual({ rows: [], hunks: [] });

    const parsed = parseGitDiff("@@ malformed @@\n+not-a-hunk");
    expect(parsed.hunks).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({ kind: "meta", content: "@@ malformed @@" }),
      expect.objectContaining({ kind: "meta", content: "+not-a-hunk" }),
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

  it("pairs replacements across end-of-file annotations without moving annotations to the other side", () => {
    const parsed = parseGitDiff(
      "@@ -1 +1 @@\n-old value\n\\ No newline at end of file\n+new value\n\\ No newline at end of file",
    );
    expect(findGitDiffChangeBlocks(parsed.rows)).toEqual([{ id: "change-block-0", startRowIndex: 1, endRowIndex: 4 }]);
    const rows = toGitDiffSideBySideRows(parsed.rows);
    expect(rows[1]).toEqual(
      expect.objectContaining({
        oldRow: expect.objectContaining({ content: "old value" }),
        newRow: expect.objectContaining({ content: "new value" }),
        isReliablePair: true,
      }),
    );
    expect(rows[2]).toEqual(
      expect.objectContaining({
        kind: "meta",
        oldRow: expect.objectContaining({ content: "\\ No newline at end of file" }),
        newRow: expect.objectContaining({ content: "\\ No newline at end of file" }),
      }),
    );
    const oneSided = toGitDiffSideBySideRows(
      parseGitDiff("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new").rows,
    );
    expect(oneSided[2].oldRow?.content).toBe("\\ No newline at end of file");
    expect(oneSided[2].newRow).toBeNull();
  });
});