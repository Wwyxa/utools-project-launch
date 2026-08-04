import { describe, expect, it } from "vitest";
import type { ProjectGitCommitSummary } from "../src/types";
import {
  collapseGitStashAuxiliaryCommits,
  GIT_COMMIT_GRAPH_GEOMETRY,
  isGitStashCommit,
  layoutGitCommitGraph,
  selectGitCommitGraphWindow,
  type GitCommitGraphLayout,
} from "../src/lib/gitCommitGraph";

const commit = (
  hash: string,
  parents: string[] = [],
  overrides: Partial<ProjectGitCommitSummary> = {},
): ProjectGitCommitSummary => ({
  hash,
  message: hash,
  author: "Test Author",
  date: "2026-08-01T00:00:00.000Z",
  parents,
  ...overrides,
});

const rowFor = (layout: GitCommitGraphLayout, hash: string) => {
  const row = layout.rows.find((candidate) => candidate.commit.hash === hash);
  if (!row) throw new Error(`Missing graph row for ${hash}`);
  return row;
};

describe("layoutGitCommitGraph", () => {
  it("recognizes structured and legacy stash references", () => {
    expect(
      isGitStashCommit(
        commit("metadata", [], {
          stash: { selector: "stash@{0}", baseHash: "base", untrackedFilesHash: null },
        }),
      ),
    ).toBe(true);
    expect(isGitStashCommit(commit("structured", [], { refNames: [{ kind: "stash", name: "stash@{0}" }] }))).toBe(true);
    expect(isGitStashCommit(commit("legacy", [], { refs: "refs/stash" }))).toBe(true);
    expect(isGitStashCommit(commit("ordinary", [], { refs: "main" }))).toBe(false);
  });

  it("collapses unreferenced stash index and untracked commits", () => {
    const commits = [
      commit("stash", ["base", "index", "untracked"], {
        refNames: [{ kind: "stash", name: "stash@{0}" }],
      }),
      commit("untracked"),
      commit("index", ["base"]),
      commit("base"),
    ];

    const compacted = collapseGitStashAuxiliaryCommits(commits);
    const layout = layoutGitCommitGraph(compacted);

    expect(compacted.map((candidate) => candidate.hash)).toEqual(["stash", "base"]);
    expect(compacted[0]?.parents).toEqual(["base"]);
    expect(commits[0]?.parents).toEqual(["base", "index", "untracked"]);
    expect(rowFor(layout, "stash").isMerge).toBe(false);
    expect(rowFor(layout, "stash").nodeLane).toBe(1);
    expect(rowFor(layout, "stash").outputLanes.map((lane) => lane.id)).toEqual(["base", "base"]);
  });

  it("keeps every leading stash in a side lane beside its base", () => {
    const layout = layoutGitCommitGraph(
      [
        commit("stash-0", ["base"], {
          stash: { selector: "stash@{0}", baseHash: "base", untrackedFilesHash: null },
        }),
        commit("stash-1", ["base"], {
          stash: { selector: "stash@{1}", baseHash: "base", untrackedFilesHash: "untracked" },
        }),
        commit("base"),
      ],
      { colorIndexByCommitHash: { "stash-0": 1, "stash-1": 1, base: 0 } },
    );

    expect(rowFor(layout, "stash-0").inputLanes.map((lane) => lane.id)).toEqual(["base"]);
    expect(rowFor(layout, "stash-0").nodeLane).toBe(1);
    expect(rowFor(layout, "stash-0").outputLanes.map((lane) => lane.id)).toEqual(["base", "base"]);
    expect(rowFor(layout, "stash-1").nodeLane).toBe(2);
    expect(rowFor(layout, "stash-1").outputLanes.map((lane) => lane.id)).toEqual(["base", "base", "base"]);
    expect(rowFor(layout, "base").inputLanes.map((lane) => lane.id)).toEqual(["base", "base", "base"]);
  });

  it("clones output lanes into the next row and terminates roots", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("B")]);

    expect(layout.rows.map((row) => row.commit.hash)).toEqual(["A", "B"]);
    expect(layout.rows[0].outputLanes.map((lane) => lane.id)).toEqual(["B"]);
    expect(layout.rows[1].inputLanes.map((lane) => lane.id)).toEqual(["B"]);
    expect(layout.rows[1].inputLanes).not.toBe(layout.rows[0].outputLanes);
    expect(layout.rows[1].inputLanes[0]).not.toBe(layout.rows[0].outputLanes[0]);
    expect(layout.rows.map((row) => row.nodeLane)).toEqual([0, 0]);
    expect(rowFor(layout, "B").segments.map((segment) => segment.kind)).toContain("root-termination");
  });

  it("keeps the merge's duplicate target lane and row-local three-lane span", () => {
    const layout = layoutGitCommitGraph([
      commit("F3", ["F2"]),
      commit("M", ["M2", "F2"]),
      commit("M2", ["B"]),
      commit("F2", ["F1"]),
      commit("F1", ["B"]),
      commit("B"),
    ]);
    const mergeRow = rowFor(layout, "M");

    expect(mergeRow.isMerge).toBe(true);
    expect(rowFor(layout, "F3").isMerge).toBe(false);
    expect(
      layout.rows.map((row) => ({
        hash: row.commit.hash,
        input: row.inputLanes.map((lane) => lane.id),
        output: row.outputLanes.map((lane) => lane.id),
        nodeLane: row.nodeLane,
        laneSpan: row.laneSpan,
      })),
    ).toEqual([
      { hash: "F3", input: [], output: ["F2"], nodeLane: 0, laneSpan: 1 },
      { hash: "M", input: ["F2"], output: ["F2", "M2", "F2"], nodeLane: 1, laneSpan: 3 },
      { hash: "M2", input: ["F2", "M2", "F2"], output: ["F2", "B", "F2"], nodeLane: 1, laneSpan: 3 },
      { hash: "F2", input: ["F2", "B", "F2"], output: ["F1", "B"], nodeLane: 0, laneSpan: 3 },
      { hash: "F1", input: ["F1", "B"], output: ["B", "B"], nodeLane: 0, laneSpan: 2 },
      { hash: "B", input: ["B", "B"], output: [], nodeLane: 0, laneSpan: 2 },
    ]);
    expect(mergeRow.segments.map((segment) => segment.kind)).toEqual([
      "vertical-bypass",
      "first-parent-continuation",
      "additional-parent-fan-out",
    ]);
    expect(
      mergeRow.segments.flatMap((segment) => (segment.parentIndex === undefined ? [] : [segment.parentIndex])),
    ).toEqual([0, 1]);
    expect(mergeRow.graphWidth).toBe(
      Math.max(
        GIT_COMMIT_GRAPH_GEOMETRY.minimumWidth,
        3 * GIT_COMMIT_GRAPH_GEOMETRY.laneWidth + GIT_COMMIT_GRAPH_GEOMETRY.paddingX * 2,
      ),
    );
    expect(rowFor(layout, "F3").graphWidth).toBeLessThan(layout.canvasWidth);
    expect(layout.canvasWidth).toBe(mergeRow.graphWidth);
  });

  it("keeps an ordinary fork's duplicate lanes until the target converges", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("C", ["B"]), commit("B", ["R"]), commit("R")]);
    const forkRow = rowFor(layout, "C");
    const targetRow = rowFor(layout, "B");

    expect(forkRow.inputLanes.map((lane) => lane.id)).toEqual(["B"]);
    expect(forkRow.outputLanes.map((lane) => lane.id)).toEqual(["B", "B"]);
    expect(forkRow.nodeLane).toBe(1);
    expect(targetRow.inputLanes.map((lane) => lane.id)).toEqual(["B", "B"]);
    expect(targetRow.outputLanes.map((lane) => lane.id)).toEqual(["R"]);
    expect(targetRow.segments.map((segment) => segment.kind)).toContain("duplicate-convergence");
  });

  it("labels first and additional merge parents with their original indices", () => {
    const layout = layoutGitCommitGraph([commit("M", ["A", "B"]), commit("A", ["R"]), commit("B", ["R"]), commit("R")]);
    const mergeRow = rowFor(layout, "M");

    expect(mergeRow.outputLanes.map((lane) => lane.id)).toEqual(["A", "B"]);
    expect(mergeRow.segments.map((segment) => ({ kind: segment.kind, parentIndex: segment.parentIndex }))).toEqual([
      { kind: "first-parent-continuation", parentIndex: 0 },
      { kind: "additional-parent-fan-out", parentIndex: 1 },
    ]);
    expect(rowFor(layout, "B").outputLanes.map((lane) => lane.id)).toEqual(["R", "R"]);
  });

  it("keeps every octopus parent in source order", () => {
    const layout = layoutGitCommitGraph([
      commit("O", ["A", "B", "C"]),
      commit("A", ["R"]),
      commit("B", ["R"]),
      commit("C", ["R"]),
      commit("R"),
    ]);
    const octopusRow = rowFor(layout, "O");

    expect(octopusRow.outputLanes.map((lane) => lane.id)).toEqual(["A", "B", "C"]);
    expect(octopusRow.segments.map((segment) => segment.kind)).toEqual([
      "first-parent-continuation",
      "additional-parent-fan-out",
      "additional-parent-fan-out",
    ]);
    expect(octopusRow.segments.map((segment) => segment.parentIndex)).toEqual([0, 1, 2]);
  });

  it("marks bypass lanes that shift after a duplicate converges", () => {
    const layout = layoutGitCommitGraph([
      commit("A", ["B"]),
      commit("C", ["B"]),
      commit("D", ["X"]),
      commit("B", ["R"]),
      commit("X", ["R"]),
      commit("R"),
    ]);
    const targetRow = rowFor(layout, "B");
    const shift = targetRow.segments.find((segment) => segment.kind === "lane-shift");

    expect(targetRow.inputLanes.map((lane) => lane.id)).toEqual(["B", "B", "X"]);
    expect(targetRow.outputLanes.map((lane) => lane.id)).toEqual(["R", "X"]);
    expect(shift).toMatchObject({ fromLane: 2, toLane: 1 });
  });

  it("does not synthesize an out-of-window page-boundary parent", () => {
    const layout = layoutGitCommitGraph([commit("A", ["OUT"])]);
    const row = rowFor(layout, "A");

    expect(row.inputLanes).toEqual([]);
    expect(row.outputLanes).toEqual([]);
    expect(row.segments).toEqual([]);
    expect(layout.rows.flatMap((candidate) => candidate.outputLanes.map((lane) => lane.id))).not.toContain("OUT");
  });

  it("uses a non-first visible parent without inventing filtered parents", () => {
    const layout = layoutGitCommitGraph([commit("F3", ["F2"]), commit("M", ["M2", "F2"]), commit("F2", ["F1"])]);
    const mergeRow = rowFor(layout, "M");

    expect(mergeRow.inputLanes.map((lane) => lane.id)).toEqual(["F2"]);
    expect(mergeRow.outputLanes.map((lane) => lane.id)).toEqual(["F2", "F2"]);
    expect(mergeRow.nodeLane).toBe(1);
    expect(mergeRow.segments.map((segment) => ({ kind: segment.kind, parentIndex: segment.parentIndex }))).toEqual([
      { kind: "vertical-bypass", parentIndex: undefined },
      { kind: "first-parent-continuation", parentIndex: 1 },
    ]);
    expect(layout.rows.flatMap((row) => row.outputLanes.map((lane) => lane.id))).not.toEqual(
      expect.arrayContaining(["M2", "F1"]),
    );
  });

  it("assigns deterministic numeric colors while retaining duplicate ids", () => {
    const commits = [
      commit("F3", ["F2"]),
      commit("M", ["M2", "F2"]),
      commit("M2", ["B"]),
      commit("F2", ["F1"]),
      commit("F1", ["B"]),
      commit("B"),
    ];
    const firstLayout = layoutGitCommitGraph(commits);
    const secondLayout = layoutGitCommitGraph(commits);

    expect(secondLayout).toEqual(firstLayout);
    expect(rowFor(firstLayout, "M").outputLanes.map((lane) => ({ id: lane.id, colorIndex: lane.colorIndex }))).toEqual([
      { id: "F2", colorIndex: 0 },
      { id: "M2", colorIndex: 1 },
      { id: "F2", colorIndex: 2 },
    ]);
  });

  it("switches the first-parent continuation to an explicit reference color", () => {
    const layout = layoutGitCommitGraph([commit("F", ["M"]), commit("M", ["A", "B"]), commit("A"), commit("B")], {
      colorIndexByCommitHash: { M: 1 },
    });
    const mergeRow = rowFor(layout, "M");

    expect(mergeRow.nodeColorIndex).toBe(1);
    expect(mergeRow.outputLanes.map((lane) => ({ id: lane.id, colorIndex: lane.colorIndex }))).toEqual([
      { id: "A", colorIndex: 1 },
      { id: "B", colorIndex: 2 },
    ]);
    expect(
      mergeRow.segments.map((segment) => ({
        kind: segment.kind,
        from: segment.from.y === mergeRow.y ? "node" : "top",
        to: segment.to.y === mergeRow.y ? "node" : "output",
        colorIndex: segment.colorIndex,
        parentIndex: segment.parentIndex,
      })),
    ).toEqual([
      { kind: "first-parent-continuation", from: "top", to: "node", colorIndex: 0, parentIndex: 0 },
      { kind: "first-parent-continuation", from: "node", to: "output", colorIndex: 1, parentIndex: 0 },
      { kind: "additional-parent-fan-out", from: "node", to: "output", colorIndex: 2, parentIndex: 1 },
    ]);
  });

  it("uses an explicit side-branch color for a merge parent", () => {
    const layout = layoutGitCommitGraph(
      [
        commit("head", ["merge"]),
        commit("merge", ["main", "side"]),
        commit("main", ["root"]),
        commit("side", ["root"]),
        commit("root"),
      ],
      { colorIndexByCommitHash: { side: 2 } },
    );

    const mergeRow = rowFor(layout, "merge");
    expect(mergeRow.outputLanes.map((lane) => ({ id: lane.id, colorIndex: lane.colorIndex }))).toEqual([
      { id: "main", colorIndex: 0 },
      { id: "side", colorIndex: 2 },
    ]);
    expect(mergeRow.segments.find((segment) => segment.parentIndex === 1)?.colorIndex).toBe(2);
    expect(rowFor(layout, "side").nodeColorIndex).toBe(2);
  });

  it("reserves a current branch color before assigning a leading branch", () => {
    const layout = layoutGitCommitGraph([commit("ahead", ["main"]), commit("main", ["base"]), commit("base")], {
      colorIndexByCommitHash: { main: 0 },
    });

    expect(rowFor(layout, "ahead").nodeColorIndex).toBe(1);
    expect(rowFor(layout, "main").nodeColorIndex).toBe(0);
    expect(rowFor(layout, "main").segments.map((segment) => segment.colorIndex)).toEqual([1, 0]);
  });

  it("uses expanded heights for later row and segment coordinates", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("B", ["C"]), commit("C")], {
      expandedRowHeights: { A: 40, B: 24 },
    });

    const rowPitch = GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap;
    expect(layout.rows.map((row) => row.y)).toEqual([
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight / 2,
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight / 2 + rowPitch + 40,
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight / 2 + rowPitch * 2 + 40 + 24,
    ]);
    expect(rowFor(layout, "A").segments[0].to.y).toBe(
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap + 40,
    );
    expect(rowFor(layout, "B").segments[0].to.y).toBe(
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap + rowPitch + 40 + 24,
    );
    expect(layout.height).toBe(
      GIT_COMMIT_GRAPH_GEOMETRY.rowHeight * 3 + GIT_COMMIT_GRAPH_GEOMETRY.rowGap * 2 + 40 + 24,
    );
    expect(layout.rows.map((row) => ({ hash: row.commit.hash, top: row.top, blockHeight: row.blockHeight }))).toEqual([
      { hash: "A", top: 0, blockHeight: 40 },
      { hash: "B", top: rowPitch + 40, blockHeight: 24 },
      { hash: "C", top: rowPitch * 2 + 40 + 24, blockHeight: 0 },
    ]);
  });

  it("selects a finite row window while retaining the preceding boundary segment", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("B", ["C"]), commit("C")]);
    const selection = selectGitCommitGraphWindow(layout, {
      top: GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap,
      height: GIT_COMMIT_GRAPH_GEOMETRY.rowHeight,
    });

    expect(selection.rows.map((row) => row.commit.hash)).toEqual(["B"]);
    expect(selection.nodes.map((row) => row.commit.hash)).toEqual(["B"]);
    expect(selection.segments.map(({ row }) => row.commit.hash)).toEqual(["A", "B"]);
  });

  it("uses inclusive geometry bounds for paths and expanded file blocks", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("B", ["C"]), commit("C")], {
      expandedRowHeights: { A: 40 },
    });
    const boundaryLayout = layoutGitCommitGraph([commit("A", ["B"]), commit("B", ["C"]), commit("C")]);
    const expandedSelection = selectGitCommitGraphWindow(layout, { top: 36, height: 20 });
    const boundarySelection = selectGitCommitGraphWindow(boundaryLayout, { top: 65, height: 1 });

    expect(expandedSelection.rows.map((row) => row.commit.hash)).toEqual(["A"]);
    expect(expandedSelection.nodes).toEqual([]);
    expect(expandedSelection.segments.map(({ row }) => row.commit.hash)).toEqual(["A"]);
    expect(boundarySelection.rows).toEqual([]);
    expect(boundarySelection.segments.map(({ row }) => row.commit.hash)).toEqual(["B", "C"]);
  });

  it("bounds a middle window while retaining its one preceding intersecting segment", () => {
    const commits = Array.from({ length: 32 }, (_, index) => commit(`C${index}`, index < 31 ? [`C${index + 1}`] : []));
    const layout = layoutGitCommitGraph(commits);
    const rowPitch = GIT_COMMIT_GRAPH_GEOMETRY.rowHeight + GIT_COMMIT_GRAPH_GEOMETRY.rowGap;
    const selection = selectGitCommitGraphWindow(layout, {
      top: rowPitch * 20,
      height: GIT_COMMIT_GRAPH_GEOMETRY.rowHeight,
      overscan: rowPitch,
    });

    expect(selection.rows.map((row) => row.commit.hash)).toEqual(["C19", "C20", "C21"]);
    expect(selection.nodes.map((row) => row.commit.hash)).toEqual(["C19", "C20", "C21"]);
    expect(selection.segments.map(({ row }) => row.commit.hash)).toEqual(["C18", "C19", "C20", "C21"]);
  });

  it("clamps invalid and trailing viewport bounds without selecting off-canvas geometry", () => {
    const layout = layoutGitCommitGraph([commit("A", ["B"]), commit("B")]);
    const selection = selectGitCommitGraphWindow(layout, { top: Number.POSITIVE_INFINITY, height: -1, overscan: -20 });

    expect(selection).toMatchObject({ top: 0, bottom: 0, rows: [], nodes: [], segments: [] });
  });
});
