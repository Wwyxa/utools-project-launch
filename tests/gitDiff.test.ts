import { describe, expect, it } from "vitest";
import {
  findGitDiffChangeBlocks,
  findGitDiffBlockInlineRanges,
  findGitDiffInlineRanges,
  highlightGitDiffRows,
  markGitDiffInlineRanges,
  markGitDiffWhitespace,
  parseGitDiff,
  toGitDiffSideBySideRows,
} from "../src/lib/gitDiff";
import { highlightCode } from "../src/lib/markdown";

describe("Git diff syntax highlighting", () => {
  it("decorates whitespace without changing text, syntax markup or escaped content", () => {
    expect(markGitDiffWhitespace('<span class="hljs-string">\t &lt;value&gt; </span>')).toBe(
      '<span class="hljs-string"><span class="diff-whitespace-tab">\t</span><span class="diff-whitespace-space"> </span>&lt;value&gt;<span class="diff-whitespace-space"> </span></span>',
    );
  });

  it("preserves multiline comments independently on each side with balanced line markup", () => {
    const parsed = parseGitDiff("@@ -1,4 +1,4 @@\n /* comment\n-old value\n+new value\n  */\n const value = 1;");
    const highlighted = highlightGitDiffRows(parsed.rows, "typescript");
    for (const row of parsed.rows.filter((item) => item.kind === "addition" || item.kind === "deletion")) {
      expect(highlighted.get(row.id)).toBe(`<span class="hljs-comment">${row.content}</span>`);
    }
    for (const html of highlighted.values()) {
      expect((html.match(/<span\b/g) || []).length).toBe((html.match(/<\/span>/g) || []).length);
    }
    expect(highlighted.get(parsed.rows.at(-1)!.id)).toContain('class="hljs-keyword"');
  });

  it("keeps template strings, escaping and inline marks across lines", () => {
    const parsed = parseGitDiff("@@ -1,3 +1,3 @@\n const text = `hello\n-<old>\n+<new>\n world`;");
    const highlighted = highlightGitDiffRows(parsed.rows, "typescript");
    const added = parsed.rows.find((row) => row.kind === "addition")!;
    expect(highlighted.get(added.id)).toBe('<span class="hljs-string">&lt;new&gt;</span>');
    expect(markGitDiffInlineRanges(highlighted.get(added.id)!, [{ start: 1, end: 4 }], "addition")).toContain(
      '<mark class="diff-inline-addition">new</mark>',
    );
  });

  it("resets missing syntax context between hunks and preserves unknown-language text", () => {
    const parsed = parseGitDiff('@@ -1 +1 @@\n /* unclosed\n@@ -20 +20 @@\n const value = "<safe>";');
    const highlighted = highlightGitDiffRows(parsed.rows, "typescript");
    expect(highlighted.get(parsed.rows.at(-1)!.id)).toContain('class="hljs-keyword"');
    expect(highlightGitDiffRows(parsed.rows, "").get(parsed.rows.at(-1)!.id)).toBe(
      "const value = &quot;&lt;safe&gt;&quot;;",
    );
  });

  it("retains different old and new syntax states on shared context lines", () => {
    const parsed = parseGitDiff("@@ -1,2 +1,2 @@\n-/* comment\n+const value = 1;\n shared text");
    const row = parsed.rows.at(-1)!;
    expect(highlightGitDiffRows(parsed.rows, "typescript", "old").get(row.id)).toBe(
      '<span class="hljs-comment">shared text</span>',
    );
    expect(highlightGitDiffRows(parsed.rows, "typescript", "new").get(row.id)).toBe("shared text");
  });
});

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

describe("inline Git diff ranges", () => {
  it("does not split surrogate pairs when highlighting changed Unicode characters", () => {
    const ranges = findGitDiffInlineRanges('const icon = "\u{1F600}";', 'const icon = "\u{1F601}";')!;
    expect(ranges.oldRanges).toEqual([{ start: 14, end: 16 }]);
    expect(ranges.newRanges).toEqual([{ start: 14, end: 16 }]);
    const rendered = markGitDiffInlineRanges(
      highlightCode('const icon = "\u{1F601}";', "typescript"),
      ranges.newRanges,
      "addition",
    );
    expect(rendered).toContain('<mark class="diff-inline-addition">\u{1F601}</mark>');
  });

  it("stops tokenizing oversized blocks before touching later rows", () => {
    const unreachableRow = {
      id: "later",
      get content(): string {
        throw new Error("Budget exceeded");
      },
    };
    expect(findGitDiffBlockInlineRanges([{ id: "large", content: "x".repeat(1025) }, unreachableRow], [])).toBeNull();
  });

  it("keeps whitespace-only changes when one side is empty", () => {
    expect(findGitDiffInlineRanges("    ", "")).toEqual({
      oldRanges: [{ start: 0, end: 4 }],
      newRanges: [],
    });
    expect(findGitDiffInlineRanges("", "\t  ")).toEqual({
      oldRanges: [],
      newRanges: [{ start: 0, end: 3 }],
    });
  });

  it("isolates inserted or deleted indentation on paired lines", () => {
    expect(findGitDiffInlineRanges("  value", "    value")).toEqual({
      oldRanges: [],
      newRanges: [{ start: 2, end: 4 }],
    });
    expect(findGitDiffInlineRanges("    value", "  value")).toEqual({
      oldRanges: [{ start: 2, end: 4 }],
      newRanges: [],
    });
  });

  it("isolates spaces inserted within a line and tab-to-space replacements", () => {
    expect(findGitDiffInlineRanges("value = 1", "value  = 1")).toEqual({
      oldRanges: [],
      newRanges: [{ start: 6, end: 7 }],
    });
    expect(findGitDiffInlineRanges("\tvalue", "  value")).toEqual({
      oldRanges: [{ start: 0, end: 1 }],
      newRanges: [{ start: 0, end: 2 }],
    });
  });

  it("keeps the first positional pair when formatting changes line counts", () => {
    const oldContent = "showRegionLabels: {";
    const newContent = "showRegionLabels: { type: Boolean, default: true },";
    const rows = toGitDiffSideBySideRows([
      { id: "old-0", kind: "deletion", content: oldContent, oldLineNumber: 43, newLineNumber: null },
      { id: "old-1", kind: "deletion", content: "  type: Boolean,", oldLineNumber: 44, newLineNumber: null },
      { id: "new-0", kind: "addition", content: newContent, oldLineNumber: null, newLineNumber: 43 },
    ]);

    expect(rows[0]?.oldRow?.content).toBe(oldContent);
    expect(rows[0]?.newRow?.content).toBe(newContent);
    expect(findGitDiffInlineRanges(oldContent, newContent)).toEqual({
      oldRanges: [],
      newRanges: [{ start: oldContent.length, end: newContent.length }],
    });
  });

  it("maps line compression without highlighting shared code tokens", () => {
    const oldRows = [
      { id: "old-0", content: "showRegionLabels: {" },
      { id: "old-1", content: "  type: Boolean," },
      { id: "old-2", content: "  default: true," },
      { id: "old-3", content: "}," },
    ];
    const newRows = [{ id: "new-0", content: "showRegionLabels: { type: Boolean, default: true }," }];
    const ranges = findGitDiffBlockInlineRanges(oldRows, newRows);

    expect(ranges).not.toBeNull();
    const oldChangedText = oldRows
      .map((row) =>
        (ranges?.get(row.id) || [])
          .filter((range) => range.start < range.end)
          .map((range) => row.content.slice(range.start, range.end))
          .join(""),
      )
      .join("");
    const newChangedText = (ranges?.get("new-0") || [])
      .filter((range) => range.start < range.end)
      .map((range) => newRows[0].content.slice(range.start, range.end))
      .join("");

    expect(oldChangedText.replace(/[\s,]/gu, "")).toBe("");
    expect(newChangedText.replace(/[\s,]/gu, "")).toBe("");
    expect(newChangedText).toContain(" ");
    expect(ranges?.get("old-0")).toContainEqual({ start: oldRows[0].content.length, end: oldRows[0].content.length });
    expect(ranges?.get("old-2")).toContainEqual({ start: oldRows[2].content.length, end: oldRows[2].content.length });

    expect(ranges?.get("old-2")).toContainEqual({
      start: oldRows[2].content.length - 1,
      end: oldRows[2].content.length,
    });

    expect(oldChangedText).toContain(",");
    expect(`${oldChangedText}${newChangedText}`).not.toMatch(/type|Boolean|default|true/u);
    const markedHtml = markGitDiffInlineRanges(
      highlightCode(oldRows[2].content, "typescript"),
      ranges?.get("old-2") || [],
      "deletion",
    );

    expect(markedHtml).toContain('<mark class="diff-inline-deletion">,</mark>');
  });

  it("maps line expansion without highlighting shared code tokens", () => {
    const oldRows = [{ id: "old-0", content: "showRegionLabels: { type: Boolean, default: true }," }];
    const newRows = [
      { id: "new-0", content: "showRegionLabels: {" },
      { id: "new-1", content: "  type: Boolean," },
      { id: "new-2", content: "  default: true," },
      { id: "new-3", content: "}," },
    ];
    const ranges = findGitDiffBlockInlineRanges(oldRows, newRows);
    const changedText = [...oldRows, ...newRows]
      .flatMap((row) =>
        (ranges?.get(row.id) || [])
          .filter((range) => range.start < range.end)
          .map((range) => row.content.slice(range.start, range.end)),
      )
      .join("");

    expect(changedText).toContain(",");
    expect(changedText).not.toMatch(/type|Boolean|default|true/u);
    expect(ranges?.get("new-0")).toContainEqual({ start: newRows[0].content.length, end: newRows[0].content.length });
    expect(ranges?.get("new-2")).toContainEqual({ start: newRows[2].content.length, end: newRows[2].content.length });
  });

  it("keeps real text replacements highlighted inside a changed block", () => {
    const oldRows = [{ id: "old-0", content: "type: Boolean," }];
    const newRows = [{ id: "new-0", content: "type: String," }];
    const ranges = findGitDiffBlockInlineRanges(oldRows, newRows);

    expect(ranges?.get("old-0")?.map((range) => oldRows[0].content.slice(range.start, range.end))).toContain("Boolean");
    expect(ranges?.get("new-0")?.map((range) => newRows[0].content.slice(range.start, range.end))).toContain("String");
  });

  it("keeps ordinary punctuation changes highlighted", () => {
    const oldRows = [{ id: "old-0", content: "items: [a, b]" }];
    const newRows = [{ id: "new-0", content: "items: [a b]" }];
    const ranges = findGitDiffBlockInlineRanges(oldRows, newRows);

    expect(ranges?.get("old-0")?.map((range) => oldRows[0].content.slice(range.start, range.end))).toContain(",");
  });

  it("keeps changed spaces and tabs as source text inside inline highlights", () => {
    expect(markGitDiffInlineRanges("\t  value", [{ start: 0, end: 3 }], "addition")).toBe(
      '<mark class="diff-inline-addition">\t  </mark>value',
    );
  });

  it("renders an empty line-break range without inserting a whitespace glyph", () => {
    expect(markGitDiffInlineRanges("value", [{ start: 5, end: 5 }], "deletion")).toBe(
      'value<mark class="diff-inline-deletion diff-inline-empty" aria-hidden="true"></mark>',
    );
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
