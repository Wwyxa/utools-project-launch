export type GitDiffRowKind = "meta" | "hunk" | "context" | "addition" | "deletion";

export interface GitDiffRow {
  id: string;
  kind: GitDiffRowKind;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  hunkId?: string;
}

export interface GitDiffHunk {
  id: string;
  index: number;
  rowIndex: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  section: string;
}

export interface ParsedGitDiff {
  rows: GitDiffRow[];
  hunks: GitDiffHunk[];
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
export const parseGitDiff = (diff: string): ParsedGitDiff => {
  if (!diff) return { rows: [], hunks: [] };

  const lines = diff.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  const rows: GitDiffRow[] = [];
  const hunks: GitDiffHunk[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let activeHunkId: string | undefined;

  lines.forEach((line, lineIndex) => {
    if (line.startsWith("diff --git ")) activeHunkId = undefined;
    const hunkMatch = HUNK_HEADER_PATTERN.exec(line);
    if (hunkMatch) {
      const hunkIndex = hunks.length;
      activeHunkId = `hunk-${hunkIndex}`;
      oldLineNumber = Number(hunkMatch[1]);
      newLineNumber = Number(hunkMatch[3]);
      hunks.push({
        id: activeHunkId,
        index: hunkIndex,
        rowIndex: rows.length,
        header: line,
        oldStart: oldLineNumber,
        oldCount: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        newStart: newLineNumber,
        newCount: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        section: hunkMatch[5].trim(),
      });
      rows.push({
        id: `line-${lineIndex}`,
        kind: "hunk",
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
        hunkId: activeHunkId,
      });
      return;
    }

    if (!activeHunkId || line.startsWith("\\ No newline at end of file")) {
      rows.push({
        id: `line-${lineIndex}`,
        kind: "meta",
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
        hunkId: activeHunkId,
      });
      return;
    }

    if (line.startsWith("+")) {
      rows.push({
        id: `line-${lineIndex}`,
        kind: "addition",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber,
        hunkId: activeHunkId,
      });
      newLineNumber += 1;
      return;
    }

    if (line.startsWith("-")) {
      rows.push({
        id: `line-${lineIndex}`,
        kind: "deletion",
        content: line.slice(1),
        oldLineNumber,
        newLineNumber: null,
        hunkId: activeHunkId,
      });
      oldLineNumber += 1;
      return;
    }

    if (line.startsWith(" ")) {
      rows.push({
        id: `line-${lineIndex}`,
        kind: "context",
        content: line.slice(1),
        oldLineNumber,
        newLineNumber,
        hunkId: activeHunkId,
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      return;
    }

    rows.push({
      id: `line-${lineIndex}`,
      kind: "meta",
      content: line,
      oldLineNumber: null,
      newLineNumber: null,
      hunkId: activeHunkId,
    });
  });

  return { rows, hunks };
};
