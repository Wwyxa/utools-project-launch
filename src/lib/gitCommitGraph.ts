import type { ProjectGitCommitSummary } from "../types";

/** Geometry shared by the layout calculation and its future renderer. */
export const GIT_COMMIT_GRAPH_GEOMETRY = {
  laneWidth: 14,
  paddingX: 2,
  minimumWidth: 24,
  rowHeight: 32,
  rowGap: 1,
} as const;

export const GIT_COMMIT_GRAPH_COLOR_INDEX = {
  currentBranch: 0,
  base: 1,
  upstream: 2,
  stash: 3,
} as const;

export const GIT_COMMIT_GRAPH_RESERVED_COLOR_INDEXES = Object.values(GIT_COMMIT_GRAPH_COLOR_INDEX);

const graphReferenceStrokeColors: Readonly<Record<number, string>> = {
  [GIT_COMMIT_GRAPH_COLOR_INDEX.currentBranch]: "#2563eb",
  [GIT_COMMIT_GRAPH_COLOR_INDEX.base]: "#d97706",
  [GIT_COMMIT_GRAPH_COLOR_INDEX.upstream]: "#db2777",
  [GIT_COMMIT_GRAPH_COLOR_INDEX.stash]: "#0f766e",
};
const graphBranchStrokeColors = ["#ffb000", "#dc267f", "#994f00", "#40b0a6", "#b66dff"];

export const gitCommitGraphStrokeColor = (colorIndex: number) => {
  const normalizedColorIndex = Number.isInteger(colorIndex) && colorIndex >= 0 ? colorIndex : 0;
  const referenceColor = graphReferenceStrokeColors[normalizedColorIndex];
  if (referenceColor) return referenceColor;
  const branchColorIndex = normalizedColorIndex - GIT_COMMIT_GRAPH_RESERVED_COLOR_INDEXES.length;
  return graphBranchStrokeColors[branchColorIndex % graphBranchStrokeColors.length] || graphBranchStrokeColors[0];
};

export interface GitCommitGraphLane {
  id: string;
  colorIndex: number;
}

/** Renderer-neutral route semantics owned by one commit row. */
export type GitCommitGraphSegmentKind =
  | "vertical-bypass"
  | "lane-shift"
  | "duplicate-convergence"
  | "first-parent-continuation"
  | "additional-parent-fan-out"
  | "root-termination";

export interface GitCommitGraphPoint {
  x: number;
  y: number;
}

/**
 * A canvas-coordinate segment. `parentIndex` points to the original index in
 * `commit.parents`, including when only a non-first parent is visible.
 */
export interface GitCommitGraphSegment {
  kind: GitCommitGraphSegmentKind;
  fromLane: number;
  toLane: number;
  from: GitCommitGraphPoint;
  to: GitCommitGraphPoint;
  colorIndex: number;
  parentIndex?: number;
}

export interface GitCommitGraphRow {
  commit: ProjectGitCommitSummary;
  inputLanes: GitCommitGraphLane[];
  outputLanes: GitCommitGraphLane[];
  nodeLane: number;
  nodeColorIndex: number;
  isMerge: boolean;
  laneSpan: number;
  graphWidth: number;
  top: number;
  blockHeight: number;
  y: number;
  segments: GitCommitGraphSegment[];
}

export interface GitCommitGraphLayoutOptions {
  /** Extra visible height immediately below each matching commit row. */
  expandedRowHeights?: Readonly<Record<string, number>>;
  /** Explicit graph colors for current, upstream, or base reference commits. */
  colorIndexByCommitHash?: Readonly<Record<string, number>>;
  /** Color slots reserved for semantic reference roles before assigning ordinary lanes. */
  reservedColorIndexes?: readonly number[];
}

export interface GitCommitGraphLayout {
  rows: GitCommitGraphRow[];
  canvasWidth: number;
  height: number;
}

export interface GitCommitGraphWindowOptions {
  top: number;
  height: number;
  overscan?: number;
}

export interface GitCommitGraphWindowSegment {
  row: GitCommitGraphRow;
  index: number;
  segment: GitCommitGraphSegment;
}

export interface GitCommitGraphWindow {
  top: number;
  bottom: number;
  rows: GitCommitGraphRow[];
  nodes: GitCommitGraphRow[];
  segments: GitCommitGraphWindowSegment[];
}

type SegmentEndpoint = "top" | "node" | "output";

interface PlannedSegment {
  kind: GitCommitGraphSegmentKind;
  fromLane: number;
  toLane: number;
  from: SegmentEndpoint;
  to: SegmentEndpoint;
  colorIndex: number;
  parentIndex?: number;
}

interface VisibleParent {
  id: string;
  parentIndex: number;
}

const laneCenter = (lane: number) =>
  GIT_COMMIT_GRAPH_GEOMETRY.paddingX +
  lane * GIT_COMMIT_GRAPH_GEOMETRY.laneWidth +
  GIT_COMMIT_GRAPH_GEOMETRY.laneWidth / 2;

const expandedRowHeight = (hash: string, options: GitCommitGraphLayoutOptions) => {
  const height = options.expandedRowHeights?.[hash] ?? 0;
  return Number.isFinite(height) ? Math.max(0, height) : 0;
};

const validGraphColorIndex = (colorIndex: unknown) =>
  typeof colorIndex === "number" && Number.isInteger(colorIndex) && colorIndex >= 0 ? colorIndex : undefined;

const explicitNodeColorIndex = (hash: string, options: GitCommitGraphLayoutOptions) =>
  validGraphColorIndex(options.colorIndexByCommitHash?.[hash]);

const nonNegativeFinite = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

const legacyCommitRefNames = (commit: ProjectGitCommitSummary) =>
  (commit.refs || "")
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);

export const isGitStashCommit = (commit: ProjectGitCommitSummary) =>
  Boolean(commit.stash) ||
  commit.refNames?.some((ref) => ref.kind === "stash") ||
  legacyCommitRefNames(commit).some((ref) => ref === "refs/stash" || /^stash@\{\d+\}$/.test(ref));

const hasNonStashRef = (commit: ProjectGitCommitSummary) => {
  if (commit.refNames?.length) return commit.refNames.some((ref) => ref.kind !== "stash");
  return legacyCommitRefNames(commit).some((ref) => ref !== "refs/stash" && !/^stash@\{\d+\}$/.test(ref));
};

export const collapseGitStashAuxiliaryCommits = (
  commits: readonly ProjectGitCommitSummary[],
): ProjectGitCommitSummary[] => {
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const auxiliaryHashes = new Set<string>();

  for (const stashCommit of commits) {
    const [baseHash, ...parentHashes] = stashCommit.parents || [];
    if (!isGitStashCommit(stashCommit) || !baseHash) continue;

    for (const [index, parentHash] of parentHashes.entries()) {
      const parent = commitsByHash.get(parentHash);
      if (!parent || hasNonStashRef(parent)) continue;

      const isIndexCommit = index === 0 && (parent.parents || []).length === 1 && parent.parents?.[0] === baseHash;
      const isUntrackedCommit = index > 0 && (parent.parents || []).length === 0;
      if (isIndexCommit || isUntrackedCommit) auxiliaryHashes.add(parentHash);
    }
  }

  return commits
    .filter((commit) => !auxiliaryHashes.has(commit.hash))
    .map((commit) => {
      const parents = commit.parents || [];
      const visibleParents = parents.filter((parentHash) => !auxiliaryHashes.has(parentHash));
      return visibleParents.length === parents.length ? commit : { ...commit, parents: visibleParents };
    });
};

const rowContentBottom = (row: GitCommitGraphRow) => row.top + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + row.blockHeight;

const firstRowIntersecting = (rows: readonly GitCommitGraphRow[], top: number) => {
  let low = 0;
  let high = rows.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (row && rowContentBottom(row) <= top) low = middle + 1;
    else high = middle;
  }

  return low;
};

export const layoutGitCommitGraph = (
  commits: readonly ProjectGitCommitSummary[],
  options: GitCommitGraphLayoutOptions = {},
): GitCommitGraphLayout => {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const rows: GitCommitGraphRow[] = [];
  let previousOutputLanes: GitCommitGraphLane[] = [];
  let nextColorIndex = 0;
  const reservedColorIndexes = new Set<number>();
  for (const colorIndex of [...(options.reservedColorIndexes ?? []), ...Object.values(options.colorIndexByCommitHash ?? {})]) {
    const reservedColorIndex = validGraphColorIndex(colorIndex);
    if (reservedColorIndex !== undefined) reservedColorIndexes.add(reservedColorIndex);
  }
  const takeNextColorIndex = () => {
    while (reservedColorIndexes.has(nextColorIndex)) nextColorIndex += 1;
    return nextColorIndex++;
  };
  let expandedHeightBeforeRow = 0;
  let height = 0;

  for (const [rowIndex, commit] of commits.entries()) {
    const inputLanes = previousOutputLanes.map((lane) => ({ ...lane }));
    const stashBaseHash = isGitStashCommit(commit) ? commit.stash?.baseHash || commit.parents?.[0] : undefined;
    if (stashBaseHash && visibleHashes.has(stashBaseHash) && !inputLanes.some((lane) => lane.id === stashBaseHash)) {
      const baseColorIndex = explicitNodeColorIndex(stashBaseHash, options) ?? takeNextColorIndex();
      nextColorIndex = Math.max(nextColorIndex, baseColorIndex + 1);
      inputLanes.push({ id: stashBaseHash, colorIndex: baseColorIndex });
    }
    const nodeLane = inputLanes.findIndex((lane) => lane.id === commit.hash);
    const resolvedNodeLane = nodeLane === -1 ? inputLanes.length : nodeLane;
    const preferredNodeColorIndex = explicitNodeColorIndex(commit.hash, options);
    const inputNodeColorIndex = inputLanes[resolvedNodeLane]?.colorIndex;
    const nodeColorIndex = preferredNodeColorIndex ?? inputNodeColorIndex ?? takeNextColorIndex();
    if (preferredNodeColorIndex !== undefined) nextColorIndex = Math.max(nextColorIndex, preferredNodeColorIndex + 1);
    const parents = commit.parents || [];
    const visibleParents: VisibleParent[] = [];

    for (const [parentIndex, parentId] of parents.entries()) {
      if (visibleHashes.has(parentId)) visibleParents.push({ id: parentId, parentIndex });
    }

    const firstVisibleParent = visibleParents[0];
    const outputLanes: GitCommitGraphLane[] = [];
    const plannedSegments: PlannedSegment[] = [];
    let hasCurrentLane = false;
    let firstVisibleParentHandled = false;

    for (const [inputLane, lane] of inputLanes.entries()) {
      if (lane.id !== commit.hash) {
        const outputLane = outputLanes.length;
        outputLanes.push({ ...lane });
        plannedSegments.push({
          kind: inputLane === outputLane ? "vertical-bypass" : "lane-shift",
          fromLane: inputLane,
          toLane: outputLane,
          from: "top",
          to: "output",
          colorIndex: lane.colorIndex,
        });
        continue;
      }

      if (!hasCurrentLane) {
        hasCurrentLane = true;
        if (firstVisibleParent) {
          const outputLane = outputLanes.length;
          const continuationColorIndex = preferredNodeColorIndex ?? lane.colorIndex;
          outputLanes.push({ id: firstVisibleParent.id, colorIndex: continuationColorIndex });
          firstVisibleParentHandled = true;
          if (continuationColorIndex === lane.colorIndex) {
            plannedSegments.push({
              kind: "first-parent-continuation",
              fromLane: inputLane,
              toLane: outputLane,
              from: "top",
              to: "output",
              colorIndex: lane.colorIndex,
              parentIndex: firstVisibleParent.parentIndex,
            });
          } else {
            plannedSegments.push({
              kind: "first-parent-continuation",
              fromLane: inputLane,
              toLane: resolvedNodeLane,
              from: "top",
              to: "node",
              colorIndex: lane.colorIndex,
              parentIndex: firstVisibleParent.parentIndex,
            });
            plannedSegments.push({
              kind: "first-parent-continuation",
              fromLane: resolvedNodeLane,
              toLane: outputLane,
              from: "node",
              to: "output",
              colorIndex: continuationColorIndex,
              parentIndex: firstVisibleParent.parentIndex,
            });
          }
        } else {
          plannedSegments.push({
            kind: parents.length === 0 ? "root-termination" : "first-parent-continuation",
            fromLane: inputLane,
            toLane: resolvedNodeLane,
            from: "top",
            to: "node",
            colorIndex: lane.colorIndex,
          });
        }
        continue;
      }

      plannedSegments.push({
        kind: "duplicate-convergence",
        fromLane: inputLane,
        toLane: resolvedNodeLane,
        from: "top",
        to: "node",
        colorIndex: lane.colorIndex,
      });
    }

    for (const parent of visibleParents) {
      if (firstVisibleParentHandled && parent === firstVisibleParent) continue;

      const isFirstVisibleParent = parent === firstVisibleParent;
      const outputLane = outputLanes.length;
      const colorIndex = isFirstVisibleParent
        ? nodeColorIndex
        : (explicitNodeColorIndex(parent.id, options) ?? takeNextColorIndex());
      outputLanes.push({ id: parent.id, colorIndex });
      plannedSegments.push({
        kind: isFirstVisibleParent ? "first-parent-continuation" : "additional-parent-fan-out",
        fromLane: resolvedNodeLane,
        toLane: outputLane,
        from: "node",
        to: "output",
        colorIndex,
        parentIndex: parent.parentIndex,
      });
      if (isFirstVisibleParent) firstVisibleParentHandled = true;
    }

    if (parents.length === 0 && !hasCurrentLane) {
      plannedSegments.push({
        kind: "root-termination",
        fromLane: resolvedNodeLane,
        toLane: resolvedNodeLane,
        from: "node",
        to: "node",
        colorIndex: nodeColorIndex,
      });
    }

    const extraHeight = expandedRowHeight(commit.hash, options);
    const rowTop =
      rowIndex * (GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap) + expandedHeightBeforeRow;
    const y = rowTop + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight / 2;
    const outputY =
      rowIndex < commits.length - 1
        ? rowTop + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap + extraHeight
        : rowTop + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight;
    const segments = plannedSegments.map((plan) => {
      const coordinate = (endpoint: SegmentEndpoint) =>
        endpoint === "top" ? rowTop : endpoint === "node" ? y : outputY;
      const segment: GitCommitGraphSegment = {
        kind: plan.kind,
        fromLane: plan.fromLane,
        toLane: plan.toLane,
        from: { x: laneCenter(plan.fromLane), y: coordinate(plan.from) },
        to: { x: laneCenter(plan.toLane), y: coordinate(plan.to) },
        colorIndex: plan.colorIndex,
      };
      if (plan.parentIndex !== undefined) segment.parentIndex = plan.parentIndex;
      return segment;
    });
    const laneSpan = Math.max(inputLanes.length, outputLanes.length, resolvedNodeLane + 1, 1);
    const graphWidth = Math.max(
      GIT_COMMIT_GRAPH_GEOMETRY.minimumWidth,
      laneSpan * GIT_COMMIT_GRAPH_GEOMETRY.laneWidth + GIT_COMMIT_GRAPH_GEOMETRY.paddingX * 2,
    );

    rows.push({
      commit,
      inputLanes,
      outputLanes,
      nodeLane: resolvedNodeLane,
      nodeColorIndex,
      isMerge: parents.length > 1,
      laneSpan,
      graphWidth,
      top: rowTop,
      blockHeight: extraHeight,
      y,
      segments,
    });
    previousOutputLanes = outputLanes;
    expandedHeightBeforeRow += extraHeight;
    height = rowTop + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + extraHeight;
  }

  return {
    rows,
    canvasWidth: rows.reduce<number>(
      (width, row) => Math.max(width, row.graphWidth),
      GIT_COMMIT_GRAPH_GEOMETRY.minimumWidth,
    ),
    height,
  };
};

export const selectGitCommitGraphWindow = (
  layout: GitCommitGraphLayout,
  options: GitCommitGraphWindowOptions,
): GitCommitGraphWindow => {
  const layoutHeight = nonNegativeFinite(layout.height);
  const viewportTop = Math.min(nonNegativeFinite(options.top), layoutHeight);
  const viewportBottom = Math.min(layoutHeight, viewportTop + nonNegativeFinite(options.height));
  const overscan = nonNegativeFinite(options.overscan);
  const top = Math.max(0, viewportTop - overscan);
  const bottom = Math.min(layoutHeight, viewportBottom + overscan);
  const firstRowIndex = firstRowIntersecting(layout.rows, top);
  const rows: GitCommitGraphRow[] = [];

  for (let index = firstRowIndex; index < layout.rows.length; index += 1) {
    const row = layout.rows[index];
    if (!row || row.top >= bottom) break;
    if (rowContentBottom(row) > top) rows.push(row);
  }

  const nodes = rows.filter((row) => row.y >= top && row.y <= bottom);
  const segments: GitCommitGraphWindowSegment[] = [];
  const firstSegmentRowIndex = Math.max(0, firstRowIndex - 1);

  for (let rowIndex = firstSegmentRowIndex; rowIndex < layout.rows.length; rowIndex += 1) {
    const row = layout.rows[rowIndex];
    if (!row || row.top > bottom) break;
    row.segments.forEach((segment, index) => {
      const segmentTop = Math.min(segment.from.y, segment.to.y);
      const segmentBottom = Math.max(segment.from.y, segment.to.y);
      if (segmentBottom >= top && segmentTop <= bottom) segments.push({ row, index, segment });
    });
  }

  return { top, bottom, rows, nodes, segments };
};
