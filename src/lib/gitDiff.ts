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
const MAX_INLINE_BLOCK_LENGTH = 8192;
const MAX_INLINE_BLOCK_TOKENS = 768;

type GitDiffToken = {
  value: string;
  start: number;
  end: number;
};

type GitDiffSequenceToken = GitDiffToken & {
  rowId: string;
  kind: "word" | "whitespace" | "punctuation" | "line-break";
  lineBreakBefore: boolean;
  lineBreakAfter: boolean;
};

const tokenizeGitDiffLine = (content: string): GitDiffToken[] =>
  Array.from(content.matchAll(INLINE_TOKEN_PATTERN), (match) => {
    const start = match.index ?? 0;
    return { value: match[0], start, end: start + match[0].length };
  });

const sequenceTokenKind = (value: string): GitDiffSequenceToken["kind"] => {
  if (/^\s+$/u.test(value)) return "whitespace";
  if (/^[\p{L}\p{N}_$]+$/u.test(value)) return "word";
  return "punctuation";
};

const tokenizeGitDiffRows = (rows: readonly Pick<GitDiffRow, "id" | "content">[]): GitDiffSequenceToken[] | null => {
  const tokens: GitDiffSequenceToken[] = [];
  let totalLength = 0;

  rows.forEach((row, rowIndex) => {
    if (row.content.length > MAX_INLINE_LINE_LENGTH) {
      totalLength = MAX_INLINE_BLOCK_LENGTH + 1;
      return;
    }

    totalLength += row.content.length;
    tokenizeGitDiffLine(row.content).forEach((token) => {
      const kind = sequenceTokenKind(token.value);
      const lineBreakBefore = token.start === 0 && rowIndex > 0;
      const lineBreakAfter = token.end === row.content.length && rowIndex < rows.length - 1;
      if (kind === "word") {
        tokens.push({ ...token, rowId: row.id, kind, lineBreakBefore, lineBreakAfter });
        return;
      }

      let offset = token.start;
      Array.from(token.value).forEach((value) => {
        const end = offset + value.length;
        tokens.push({ value, start: offset, end, rowId: row.id, kind, lineBreakBefore, lineBreakAfter });
        offset = end;
      });
    });

    if (rowIndex < rows.length - 1) {
      totalLength += 1;
      tokens.push({
        value: "\n",
        start: row.content.length,
        end: row.content.length,
        rowId: row.id,
        kind: "line-break",
        lineBreakBefore: false,
        lineBreakAfter: false,
      });
    }
  });

  if (totalLength > MAX_INLINE_BLOCK_LENGTH || tokens.length > MAX_INLINE_BLOCK_TOKENS) return null;
  return tokens;
};

const sequenceTokensEqual = (oldToken: GitDiffSequenceToken, newToken: GitDiffSequenceToken) =>
  oldToken.kind === newToken.kind &&
  oldToken.value === newToken.value &&
  (oldToken.kind !== "whitespace" ||
    (oldToken.lineBreakBefore === newToken.lineBreakBefore && oldToken.lineBreakAfter === newToken.lineBreakAfter));

const sequenceTokenWeight = (token: GitDiffSequenceToken) => (token.kind === "word" ? 4 : 1);

const addSequenceTokenRange = (rangesByRowId: Map<string, GitDiffInlineRange[]>, token: GitDiffSequenceToken) => {
  const ranges = rangesByRowId.get(token.rowId) || [];
  ranges.push({ start: token.start, end: token.end });
  rangesByRowId.set(token.rowId, ranges);
};

const trimGitDiffSequenceTokenPair = (oldToken: GitDiffSequenceToken, newToken: GitDiffSequenceToken) => {
  let oldStart = 0;
  let oldEnd = oldToken.value.length;
  let newStart = 0;
  let newEnd = newToken.value.length;

  while (oldStart < oldEnd && newStart < newEnd && oldToken.value[oldStart] === newToken.value[newStart]) {
    oldStart += 1;
    newStart += 1;
  }
  while (oldStart < oldEnd && newStart < newEnd && oldToken.value[oldEnd - 1] === newToken.value[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    oldRange: oldStart < oldEnd ? { start: oldToken.start + oldStart, end: oldToken.start + oldEnd } : null,
    newRange: newStart < newEnd ? { start: newToken.start + newStart, end: newToken.start + newEnd } : null,
  };
};

const normalizeGitDiffInlineRanges = (ranges: GitDiffInlineRange[]) => {
  const normalized: GitDiffInlineRange[] = [];
  ranges
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach((range) => {
      if (range.start < 0 || range.end < range.start) return;
      if (range.start === range.end) {
        if (!normalized.some((item) => item.start === range.start && item.end === range.end)) {
          normalized.push({ ...range });
        }
        return;
      }

      const previous = normalized.at(-1);
      if (previous && previous.start < previous.end && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        normalized.push({ ...range });
      }
    });
  return normalized;
};

export const findGitDiffBlockInlineRanges = (
  oldRows: readonly Pick<GitDiffRow, "id" | "content">[],
  newRows: readonly Pick<GitDiffRow, "id" | "content">[],
): Map<string, GitDiffInlineRange[]> | null => {
  const oldTokens = tokenizeGitDiffRows(oldRows);
  const newTokens = tokenizeGitDiffRows(newRows);
  if (!oldTokens || !newTokens) return null;

  const columnCount = newTokens.length + 1;
  const scores = new Uint16Array((oldTokens.length + 1) * columnCount);
  const scoreAt = (oldIndex: number, newIndex: number) => scores[oldIndex * columnCount + newIndex];

  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      scores[oldIndex * columnCount + newIndex] = sequenceTokensEqual(oldTokens[oldIndex], newTokens[newIndex])
        ? scoreAt(oldIndex + 1, newIndex + 1) + sequenceTokenWeight(oldTokens[oldIndex])
        : Math.max(scoreAt(oldIndex + 1, newIndex), scoreAt(oldIndex, newIndex + 1));
    }
  }

  const oldRangesByRowId = new Map<string, GitDiffInlineRange[]>();
  const newRangesByRowId = new Map<string, GitDiffInlineRange[]>();
  const oldChangedTokens: GitDiffSequenceToken[] = [];
  const newChangedTokens: GitDiffSequenceToken[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  const flushChange = () => {
    const canTrimPairs =
      oldChangedTokens.length === newChangedTokens.length &&
      oldChangedTokens.every(
        (token, index) =>
          (token.kind === "word" || token.kind === "punctuation") && token.kind === newChangedTokens[index]?.kind,
      );
    if (canTrimPairs) {
      oldChangedTokens.forEach((oldToken, index) => {
        const newToken = newChangedTokens[index];
        const trimmed = trimGitDiffSequenceTokenPair(oldToken, newToken);
        if (trimmed.oldRange) addSequenceTokenRange(oldRangesByRowId, { ...oldToken, ...trimmed.oldRange });
        if (trimmed.newRange) addSequenceTokenRange(newRangesByRowId, { ...newToken, ...trimmed.newRange });
      });
    } else {
      oldChangedTokens.forEach((token) => addSequenceTokenRange(oldRangesByRowId, token));
      newChangedTokens.forEach((token) => addSequenceTokenRange(newRangesByRowId, token));
    }
    oldChangedTokens.length = 0;
    newChangedTokens.length = 0;
  };

  while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
    if (
      oldIndex < oldTokens.length &&
      newIndex < newTokens.length &&
      sequenceTokensEqual(oldTokens[oldIndex], newTokens[newIndex])
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
      oldChangedTokens.push(oldTokens[oldIndex]);
      oldIndex += 1;
      continue;
    }

    newChangedTokens.push(newTokens[newIndex]);
    newIndex += 1;
  }
  flushChange();

  const rangesByRowId = new Map<string, GitDiffInlineRange[]>();
  const rowIds = new Set([...oldRangesByRowId.keys(), ...newRangesByRowId.keys()]);
  rowIds.forEach((rowId) => {
    const normalized = normalizeGitDiffInlineRanges([
      ...(oldRangesByRowId.get(rowId) || []),
      ...(newRangesByRowId.get(rowId) || []),
    ]);
    if (normalized.length) rangesByRowId.set(rowId, normalized);
  });
  return rangesByRowId;
};

export const findGitDiffInlineRanges = (oldContent: string, newContent: string): GitDiffInlineRanges | null => {
  if (oldContent === newContent) return null;

  const rangesByRowId = findGitDiffBlockInlineRanges(
    [{ id: "old", content: oldContent }],
    [{ id: "new", content: newContent }],
  );
  if (!rangesByRowId) return null;

  const oldRanges = rangesByRowId.get("old") || [];
  const newRanges = rangesByRowId.get("new") || [];
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
  const nonEmptyRanges: GitDiffInlineRange[] = [];
  const emptyOffsets = new Set<number>();
  ranges
    .filter(
      (range) =>
        Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start,
    )
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach((range) => {
      if (range.start === range.end) {
        emptyOffsets.add(range.start);
        return;
      }

      const previous = nonEmptyRanges.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        nonEmptyRanges.push({ ...range });
      }
    });
  const emptyRangeOffsets = [...emptyOffsets].sort((left, right) => left - right);
  if (nonEmptyRanges.length === 0 && emptyRangeOffsets.length === 0) return highlightedHtml;

  const markClass = kind === "addition" ? "diff-inline-addition" : "diff-inline-deletion";
  let output = "";
  let htmlIndex = 0;
  let sourceOffset = 0;
  let rangeIndex = 0;
  let emptyRangeIndex = 0;
  let markOpen = false;

  const closeMarkIfDone = () => {
    while (rangeIndex < nonEmptyRanges.length && sourceOffset >= nonEmptyRanges[rangeIndex].end) {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      rangeIndex += 1;
    }
  };
  const appendEmptyMarksAt = () => {
    while (emptyRangeIndex < emptyRangeOffsets.length && sourceOffset >= emptyRangeOffsets[emptyRangeIndex]) {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      output += `<mark class="${markClass} diff-inline-empty" aria-hidden="true"></mark>`;
      emptyRangeIndex += 1;
    }
  };
  const openMarkIfNeeded = () => {
    const range = nonEmptyRanges[rangeIndex];
    if (!range || markOpen || sourceOffset < range.start || sourceOffset >= range.end) return;
    output += `<mark class="${markClass}">`;
    markOpen = true;
  };

  while (htmlIndex < highlightedHtml.length) {
    closeMarkIfDone();
    appendEmptyMarksAt();
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

  closeMarkIfDone();
  appendEmptyMarksAt();
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
