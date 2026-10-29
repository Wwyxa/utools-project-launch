import { describe, expect, it } from "vitest";
import type { ProjectGitCommitSummary } from "../src/types";
import { layoutGitCommitGraph, type GitCommitGraphLayout } from "../src/lib/gitCommitGraph";

const commit = (hash: string, parents: string[] = []): ProjectGitCommitSummary => ({
  hash,
  message: hash,
  author: "Test Author",
  date: "2026-08-01T00:00:00.000Z",
  parents,
});

const rowFor = (layout: GitCommitGraphLayout, hash: string) => {
  const row = layout.rows.find((candidate) => candidate.commit.hash === hash);
  if (!row) throw new Error(`Missing graph row for ${hash}`);
  return row;
};

describe("layoutGitCommitGraph", () => {
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

  it("does not synthesize an out-of-window page-boundary parent", () => {
    const layout = layoutGitCommitGraph([commit("A", ["OUT"])]);
    const row = rowFor(layout, "A");

    expect(row.inputLanes).toEqual([]);
    expect(row.outputLanes).toEqual([]);
    expect(row.segments).toEqual([]);
    expect(layout.rows.flatMap((candidate) => candidate.outputLanes.map((lane) => lane.id))).not.toContain("OUT");
  });
});