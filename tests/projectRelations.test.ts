import { describe, expect, it } from "vitest";
import { PROJECT_MAX_RELATED_PROJECTS, ProjectStatus } from "../src/types";
import type { Project } from "../src/types";
import { normalizeProjectRelations, resolveProjectRelatedProjectIds } from "../src/lib/projectRelations";

const project = (id: string, relatedProjects: Project["relatedProjects"] = []): Project => ({
  id,
  name: id,
  path: `C:/workspace/${id}`,
  type: "Node.js",
  kind: "node",
  status: ProjectStatus.STOPPED,
  scripts: [],
  env: {},
  relatedProjects,
});

describe("project relations", () => {
  it("normalizes duplicate, invalid, and excess relation entries", () => {
    expect(
      normalizeProjectRelations([
        { projectId: " api ", bidirectional: true },
        { projectId: "api", bidirectional: false },
        { projectId: "", bidirectional: true },
        { projectId: "web", bidirectional: false },
        { projectId: "docs", bidirectional: true },
        { projectId: "worker", bidirectional: true },
      ]),
    ).toEqual([
      { projectId: "api", bidirectional: true },
      { projectId: "web", bidirectional: false },
      { projectId: "docs", bidirectional: true },
    ]);
  });

  it("resolves direct relations first, then incoming bidirectional relations", () => {
    const projects = [
      project("frontend", [
        { projectId: "api", bidirectional: false },
        { projectId: "docs", bidirectional: true },
        { projectId: "missing", bidirectional: true },
      ]),
      project("api", [{ projectId: "frontend", bidirectional: true }]),
      project("docs"),
      project("worker", [{ projectId: "frontend", bidirectional: true }]),
      project("one-way", [{ projectId: "frontend", bidirectional: false }]),
    ];

    expect(resolveProjectRelatedProjectIds("frontend", projects)).toEqual(["api", "docs", "worker"]);
  });

  it("keeps the configured maximum for direct relation entries", () => {
    const normalized = normalizeProjectRelations(
      Array.from({ length: PROJECT_MAX_RELATED_PROJECTS + 1 }, (_, index) => ({
        projectId: `project-${index + 1}`,
        bidirectional: false,
      })),
    );

    expect(normalized).toHaveLength(PROJECT_MAX_RELATED_PROJECTS);
  });
});
