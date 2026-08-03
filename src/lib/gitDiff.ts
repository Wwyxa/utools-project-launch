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

export interface GitDiffChangeBlock {
  id: string;
  startRowIndex: number;
  endRowIndex: number;
}

export interface ParsedGitDiff {
  rows: GitDiffRow[];
  hunks: GitDiffHunk[];
}

export interface GitDiffInlineRange {
  start: number;
  end: number;
}

export interface GitDiffInlineRanges {
  oldRanges: GitDiffInlineRange[];
  newRanges: GitDiffInlineRange[];
}

export type GitDiffSideBySideRowKind = "meta" | "hunk" | "context" | "change";

export interface GitDiffSideBySideRow {
  id: string;
  kind: GitDiffSideBySideRowKind;
  oldRow: GitDiffRow | null;
  newRow: GitDiffRow | null;
  isReliablePair?: boolean;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const INLINE_TOKEN_PATTERN = /[\p{L}\p{N}_$]+|\s+|[^\s\p{L}\p{N}_$]+/gu;
const MAX_INLINE_LINE_LENGTH = 1024;
const MAX_INLINE_TOKENS = 128;
const MAX_INLINE_RANGES = 4;

type GitDiffToken = {
  value: string;
  start: number;
  end: number;
};

const tokenizeGitDiffLine = (content: string): GitDiffToken[] =>
  Array.from(content.matchAll(INLINE_TOKEN_PATTERN), (match) => {
    const start = match.index ?? 0;
    return { value: match[0], start, end: start + match[0].length };
  });

const trimGitDiffRangePair = (
  oldContent: string,
  newContent: string,
  oldRange: GitDiffInlineRange | null,
  newRange: GitDiffInlineRange | null,
) => {
  if (!oldRange || !newRange) return { oldRange, newRange };

  let oldStart = oldRange.start;
  let oldEnd = oldRange.end;
  let newStart = newRange.start;
  let newEnd = newRange.end;

  while (oldStart < oldEnd && newStart < newEnd && oldContent[oldStart] === newContent[newStart]) {
    oldStart += 1;
    newStart += 1;
  }
  while (oldStart < oldEnd && newStart < newEnd && oldContent[oldEnd - 1] === newContent[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    oldRange: oldStart < oldEnd ? { start: oldStart, end: oldEnd } : null,
    newRange: newStart < newEnd ? { start: newStart, end: newEnd } : null,
  };
};

export const findGitDiffInlineRanges = (oldContent: string, newContent: string): GitDiffInlineRanges | null => {
  if (
    oldContent === newContent ||
    !oldContent ||
    !newContent ||
    oldContent.length > MAX_INLINE_LINE_LENGTH ||
    newContent.length > MAX_INLINE_LINE_LENGTH
  ) {
    return null;
  }

  const oldTokens = tokenizeGitDiffLine(oldContent);
  const newTokens = tokenizeGitDiffLine(newContent);
  if (
    oldTokens.length === 0 ||
    newTokens.length === 0 ||
    oldTokens.length > MAX_INLINE_TOKENS ||
    newTokens.length > MAX_INLINE_TOKENS
  ) {
    return null;
  }

  const columnCount = newTokens.length + 1;
  const scores = new Uint16Array((oldTokens.length + 1) * columnCount);
  const scoreAt = (oldIndex: number, newIndex: number) => scores[oldIndex * columnCount + newIndex];

  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      scores[oldIndex * columnCount + newIndex] =
        oldTokens[oldIndex].value === newTokens[newIndex].value
          ? scoreAt(oldIndex + 1, newIndex + 1) + 1
          : Math.max(scoreAt(oldIndex + 1, newIndex), scoreAt(oldIndex, newIndex + 1));
    }
  }

  const oldRanges: GitDiffInlineRange[] = [];
  const newRanges: GitDiffInlineRange[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let oldChangeStart: number | null = null;
  let newChangeStart: number | null = null;

  const flushChange = () => {
    const oldRange =
      oldChangeStart == null ? null : { start: oldTokens[oldChangeStart].start, end: oldTokens[oldIndex - 1].end };
    const newRange =
      newChangeStart == null ? null : { start: newTokens[newChangeStart].start, end: newTokens[newIndex - 1].end };
    const trimmed = trimGitDiffRangePair(oldContent, newContent, oldRange, newRange);
    if (trimmed.oldRange) oldRanges.push(trimmed.oldRange);
    if (trimmed.newRange) newRanges.push(trimmed.newRange);
    oldChangeStart = null;
    newChangeStart = null;
  };

  while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
    if (
      oldIndex < oldTokens.length &&
      newIndex < newTokens.length &&
      oldTokens[oldIndex].value === newTokens[newIndex].value
    ) {
      flushChange();
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (
      oldIndex < oldTokens.length &&
      (newIndex === newTokens.length || scoreAt(oldIndex + 1, newIndex) >= scoreAt(oldIndex, newIndex + 1))
    ) {
      if (oldChangeStart == null) oldChangeStart = oldIndex;
      oldIndex += 1;
      continue;
    }

    if (newChangeStart == null) newChangeStart = newIndex;
    newIndex += 1;
  }
  flushChange();

  if (
    (!oldRanges.length && !newRanges.length) ||
    oldRanges.length > MAX_INLINE_RANGES ||
    newRanges.length > MAX_INLINE_RANGES
  ) {
    return null;
  }
  return { oldRanges, newRanges };
};

export const markGitDiffInlineRanges = (
  highlightedHtml: string,
  ranges: GitDiffInlineRange[],
  kind: "addition" | "deletion",
) => {
  const validRanges: GitDiffInlineRange[] = [];
  ranges
    .filter(
      (range) =>
        Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start,
    )
    .slice()
    .sort((left, right) => left.start - right.start)
    .forEach((range) => {
      const previous = validRanges.at(-1);
      if (previous && range.start < previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        validRanges.push({ ...range });
      }
    });
  if (!highlightedHtml || validRanges.length === 0) return highlightedHtml;

  const markClass = kind === "addition" ? "diff-inline-addition" : "diff-inline-deletion";
  let output = "";
  let htmlIndex = 0;
  let sourceOffset = 0;
  let rangeIndex = 0;
  let markOpen = false;

  const closeMarkIfDone = () => {
    while (rangeIndex < validRanges.length && sourceOffset >= validRanges[rangeIndex].end) {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      rangeIndex += 1;
    }
  };
  const openMarkIfNeeded = () => {
    const range = validRanges[rangeIndex];
    if (!range || markOpen || sourceOffset < range.start || sourceOffset >= range.end) return;
    output += `<mark class="${markClass}">`;
    markOpen = true;
  };

  while (htmlIndex < highlightedHtml.length) {
    closeMarkIfDone();
    if (highlightedHtml[htmlIndex] === "<") {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      const tagEndIndex = highlightedHtml.indexOf(">", htmlIndex);
      if (tagEndIndex === -1) return highlightedHtml;
      output += highlightedHtml.slice(htmlIndex, tagEndIndex + 1);
      htmlIndex = tagEndIndex + 1;
      continue;
    }

    openMarkIfNeeded();
    if (highlightedHtml[htmlIndex] === "&") {
      const entityEndIndex = highlightedHtml.indexOf(";", htmlIndex + 1);
      if (entityEndIndex !== -1) {
        output += highlightedHtml.slice(htmlIndex, entityEndIndex + 1);
        htmlIndex = entityEndIndex + 1;
        sourceOffset += 1;
        continue;
      }
    }

    output += highlightedHtml[htmlIndex];
    htmlIndex += 1;
    sourceOffset += 1;
  }

  if (markOpen) output += "</mark>";
  return output;
};

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

export const findGitDiffChangeBlocks = (rows: GitDiffRow[]): GitDiffChangeBlock[] => {
  const blocks: GitDiffChangeBlock[] = [];
  let startRowIndex = -1;

  rows.forEach((row, rowIndex) => {
    const isChange = row.kind === "addition" || row.kind === "deletion";
    if (isChange) {
      if (startRowIndex === -1) startRowIndex = rowIndex;
      return;
    }

    if (startRowIndex === -1) return;
    blocks.push({ id: `change-block-${blocks.length}`, startRowIndex, endRowIndex: rowIndex - 1 });
    startRowIndex = -1;
  });

  if (startRowIndex !== -1) {
    blocks.push({ id: `change-block-${blocks.length}`, startRowIndex, endRowIndex: rows.length - 1 });
  }

  return blocks;
};

export const toGitDiffSideBySideRows = (rows: GitDiffRow[]): GitDiffSideBySideRow[] => {
  const sideBySideRows: GitDiffSideBySideRow[] = [];
  let changeBlock: GitDiffRow[] = [];

  const flushChangeBlock = () => {
    if (!changeBlock.length) return;

    const deletions = changeBlock.filter((row) => row.kind === "deletion");
    const additions = changeBlock.filter((row) => row.kind === "addition");
    const rowCount = Math.max(deletions.length, additions.length);
    const isReliablePair = deletions.length === additions.length;
    for (let index = 0; index < rowCount; index += 1) {
      sideBySideRows.push({
        id: `${changeBlock[0].id}-side-by-side-${index}`,
        kind: "change",
        oldRow: deletions[index] || null,
        newRow: additions[index] || null,
        isReliablePair: isReliablePair && Boolean(deletions[index] && additions[index]),
      });
    }
    changeBlock = [];
  };

  rows.forEach((row) => {
    if (row.kind === "deletion" || row.kind === "addition") {
      changeBlock.push(row);
      return;
    }

    flushChangeBlock();
    if (row.kind === "hunk") {
      sideBySideRows.push({ id: row.id, kind: "hunk", oldRow: row, newRow: row });
    } else if (row.kind === "meta") {
      sideBySideRows.push({ id: row.id, kind: "meta", oldRow: row, newRow: row });
    } else {
      sideBySideRows.push({ id: row.id, kind: "context", oldRow: row, newRow: row });
    }
  });

  flushChangeBlock();
  return sideBySideRows;
};
