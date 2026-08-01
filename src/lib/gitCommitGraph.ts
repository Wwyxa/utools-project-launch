import type { ProjectGitCommitSummary } from "../types";

/** Geometry shared by the layout calculation and its future renderer. */
export const GIT_COMMIT_GRAPH_GEOMETRY = {
  laneWidth: 14,
  paddingX: 3,
  minimumWidth: 28,
  rowHeight: 32,
  rowGap: 1,
} as const;

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
  laneSpan: number;
  graphWidth: number;
  y: number;
  segments: GitCommitGraphSegment[];
}

export interface GitCommitGraphLayoutOptions {
  /** Extra visible height immediately below each matching commit row. */
  expandedRowHeights?: Readonly<Record<string, number>>;
}

export interface GitCommitGraphLayout {
  rows: GitCommitGraphRow[];
  canvasWidth: number;
  height: number;
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
  GIT_COMMIT_GRAPH_GEOMETRY.paddingX + lane * GIT_COMMIT_GRAPH_GEOMETRY.laneWidth + GIT_COMMIT_GRAPH_GEOMETRY.laneWidth / 2;

const expandedRowHeight = (hash: string, options: GitCommitGraphLayoutOptions) => {
  const height = options.expandedRowHeights?.[hash] ?? 0;
  return Number.isFinite(height) ? Math.max(0, height) : 0;
};

export const layoutGitCommitGraph = (
  commits: readonly ProjectGitCommitSummary[],
  options: GitCommitGraphLayoutOptions = {},
): GitCommitGraphLayout => {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const rows: GitCommitGraphRow[] = [];
  let previousOutputLanes: GitCommitGraphLane[] = [];
  let nextColorIndex = 0;
  let expandedHeightBeforeRow = 0;
  let height = 0;

  for (const [rowIndex, commit] of commits.entries()) {
    const inputLanes = previousOutputLanes.map((lane) => ({ ...lane }));
    const nodeLane = inputLanes.findIndex((lane) => lane.id === commit.hash);
    const resolvedNodeLane = nodeLane === -1 ? inputLanes.length : nodeLane;
    const nodeColorIndex = inputLanes[resolvedNodeLane]?.colorIndex ?? nextColorIndex++;
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
          outputLanes.push({ id: firstVisibleParent.id, colorIndex: lane.colorIndex });
          firstVisibleParentHandled = true;
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
      const colorIndex = isFirstVisibleParent ? nodeColorIndex : nextColorIndex++;
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
    const rowTop = rowIndex * (GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap) + expandedHeightBeforeRow;
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
      laneSpan,
      graphWidth,
      y,
      segments,
    });
    previousOutputLanes = outputLanes;
    expandedHeightBeforeRow += extraHeight;
    height = rowTop + GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + extraHeight;
  }

  return {
    rows,
    canvasWidth: rows.reduce((width, row) => Math.max(width, row.graphWidth), GIT_COMMIT_GRAPH_GEOMETRY.minimumWidth),
    height,
  };
};