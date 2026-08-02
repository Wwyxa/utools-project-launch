import { describe, expect, it } from "vitest";
import type { ProjectGitCommitRef, ProjectGitCommitSummary } from "../types";
import { presentGitCommitRefs, type GitCommitRefPresentationContext } from "./gitCommitRefs";

const commit = (refNames?: ProjectGitCommitRef[], refs?: string, hash = "head"): ProjectGitCommitSummary => ({
  hash,
  message: "test commit",
  author: "Test Author",
  date: "2026-08-01T00:00:00.000Z",
  ...(refNames === undefined ? {} : { refNames }),
  ...(refs === undefined ? {} : { refs }),
});

const gitContext = (overrides: Partial<GitCommitRefPresentationContext> = {}): GitCommitRefPresentationContext => ({
  branch: "main",
  headHash: "head",
  branches: [
    { name: "main", current: true },
    { name: "alpha", current: false },
    { name: "feature/colored", current: false },
    { name: "release", current: false },
    { name: "zeta", current: false },
  ],
  remotes: [
    { name: "origin", fetchUrl: "", pushUrl: "" },
    { name: "fork", fetchUrl: "", pushUrl: "" },
    { name: "remote", fetchUrl: "", pushUrl: "" },
  ],
  upstream: { remote: "origin", branch: "main", ref: "origin/main", ahead: 0, behind: 0 },
  ...overrides,
});

describe("presentGitCommitRefs", () => {
  it("orders structured HEAD, upstream, graph-colored, and remaining ref kinds", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "tag", name: "z-tag" },
        { kind: "remote", name: "origin/HEAD" },
        { kind: "local", name: "zeta" },
        { kind: "remote", name: "origin/main" },
        { kind: "local", name: "feature/colored" },
        { kind: "head", name: "HEAD -> main", head: true },
        { kind: "tag", name: "a-tag" },
        { kind: "remote", name: "fork/topic" },
        { kind: "local", name: "alpha" },
      ]),
      gitContext({ graphColorByRefName: { "feature/colored": 7 } }),
    );

    expect(presentation.full.map((member) => member.name)).toEqual([
      "HEAD -> main",
      "origin/main",
      "feature/colored",
      "alpha",
      "zeta",
      "fork/topic",
      "origin/HEAD",
      "a-tag",
      "z-tag",
    ]);
    expect(presentation.full.map((member) => member.kind)).toEqual([
      "head",
      "remote",
      "local",
      "local",
      "local",
      "remote",
      "remote",
      "tag",
      "tag",
    ]);
    expect(presentation.full.map((member) => member.priority)).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5]);
    expect(presentation.full.map((member) => member.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(presentation.full[0]).toMatchObject({
      identity: "head:HEAD -> main",
      label: "main",
      isCurrentHead: true,
      isCurrentUpstream: false,
    });
    expect(presentation.full[1]).toMatchObject({ isCurrentUpstream: true, graphColorIndex: undefined });
    expect(presentation.full[2]).toMatchObject({ graphColorIndex: 7, groupKey: "7:local" });
  });

  it("matches the abbreviated snapshot HEAD to a full commit hash", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    const presentation = presentGitCommitRefs(
      commit([{ kind: "head", name: "HEAD -> main", head: true }], undefined, hash),
      gitContext({ headHash: hash.slice(0, 7) }),
    );

    expect(presentation.full[0]).toMatchObject({
      name: "HEAD -> main",
      priority: 0,
      isCurrentHead: true,
    });
  });

  it("hides only the duplicate HEAD local while preserving every remote in dense output", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "head", name: "HEAD -> main", head: true },
        { kind: "local", name: "main", head: true },
        { kind: "local", name: "release" },
        { kind: "remote", name: "origin/HEAD" },
        { kind: "remote", name: "origin/main" },
        { kind: "remote", name: "fork/topic" },
        { kind: "tag", name: "main" },
      ]),
      gitContext(),
    );

    expect(presentation.dense.hiddenMembers.map((member) => member.name)).toEqual(["main"]);
    expect(presentation.dense.members.filter((member) => member.kind === "local").map((member) => member.name)).toEqual(["release"]);
    expect(presentation.dense.members.filter((member) => member.kind === "tag").map((member) => member.name)).toEqual(["main"]);
    expect(presentation.dense.members.find((member) => member.isCurrentHead)).toMatchObject({
      name: "HEAD -> main",
      display: "label",
    });
    expect(
      presentation.dense.members
        .filter((member) => member.kind === "remote")
        .map(({ name, display, title, memberNames, memberTitles }) => ({ name, display, title, memberNames, memberTitles })),
    ).toEqual([
      {
        name: "origin/main",
        display: "label",
        title: "origin/main",
        memberNames: ["origin/main"],
        memberTitles: ["origin/main"],
      },
      {
        name: "fork/topic",
        display: "icon",
        title: "fork/topic",
        memberNames: ["fork/topic"],
        memberTitles: ["fork/topic"],
      },
      {
        name: "origin/HEAD",
        display: "icon",
        title: "origin/HEAD",
        memberNames: ["origin/HEAD"],
        memberTitles: ["origin/HEAD"],
      },
    ]);
    expect(presentation.full.map(({ name, title }) => ({ name, title }))).toEqual([
      { name: "HEAD -> main", title: "HEAD -> main" },
      { name: "origin/main", title: "origin/main" },
      { name: "main", title: "main" },
      { name: "release", title: "release" },
      { name: "fork/topic", title: "fork/topic" },
      { name: "origin/HEAD", title: "origin/HEAD" },
      { name: "main", title: "main" },
    ]);
  });

  it("keeps one non-remote representative beside the primary remote while icon-compacting other refs", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "local", name: "main" },
        { kind: "remote", name: "origin/main" },
        { kind: "remote", name: "origin/HEAD" },
        { kind: "tag", name: "release,annotated" },
      ]),
      gitContext(),
    );

    expect(presentation.full.map((member) => member.name)).toEqual(["origin/main", "main", "origin/HEAD", "release,annotated"]);
    expect(
      presentation.dense.members.map(({ name, display, title, memberNames, memberTitles }) => ({
        name,
        display,
        title,
        memberNames,
        memberTitles,
      })),
    ).toEqual([
      {
        name: "origin/main",
        display: "label",
        title: "origin/main",
        memberNames: ["origin/main"],
        memberTitles: ["origin/main"],
      },
      {
        name: "origin/HEAD",
        display: "icon",
        title: "origin/HEAD",
        memberNames: ["origin/HEAD"],
        memberTitles: ["origin/HEAD"],
      },
      {
        name: "main",
        display: "label",
        title: "main",
        memberNames: ["main"],
        memberTitles: ["main"],
      },
      {
        name: "release,annotated",
        display: "icon",
        title: "release,annotated",
        memberNames: ["release,annotated"],
        memberTitles: ["release,annotated"],
      },
    ]);
  });

  it("keeps one remote labeled and never promotes symbolic remote HEAD refs", () => {
    const singleRemote = presentGitCommitRefs(commit([{ kind: "remote", name: "origin/develop" }]), gitContext({ upstream: null }));
    const symbolicRemotes = presentGitCommitRefs(
      commit([
        { kind: "remote", name: "remote/HEAD" },
        { kind: "remote", name: "origin/HEAD" },
        { kind: "remote", name: "fork/HEAD" },
      ]),
      gitContext({ upstream: null }),
    );

    expect(singleRemote.dense.members).toEqual([
      expect.objectContaining({ name: "origin/develop", display: "label", title: "origin/develop" }),
    ]);
    expect(symbolicRemotes.full.map((member) => member.kind)).toEqual(["remote", "remote", "remote"]);
    expect(symbolicRemotes.full.every((member) => !member.isCurrentHead)).toBe(true);
    expect(symbolicRemotes.dense.members.map(({ name, display }) => ({ name, display }))).toEqual([
      { name: "fork/HEAD", display: "label" },
      { name: "origin/HEAD", display: "icon" },
      { name: "remote/HEAD", display: "icon" },
    ]);
  });

  it("keeps structured comma names and annotated tags intact without legacy parsing", () => {
    const presentation = presentGitCommitRefs(
      commit(
        [
          { kind: "tag", name: "release,annotated" },
          { kind: "local", name: "feature/a,b" },
        ],
        "HEAD -> ignored, legacy-only",
      ),
      gitContext(),
    );

    expect(presentation.full.map((member) => member.name)).toEqual(["feature/a,b", "release,annotated"]);
    expect(presentation.full.map((member) => member.identity)).toEqual(["local:feature/a,b", "tag:release,annotated"]);
    expect(presentation.full.map((member) => member.title)).toEqual(["feature/a,b", "release,annotated"]);
  });

  it("uses the comma-compatible legacy fallback only when structured refs are absent", () => {
    const legacyPresentation = presentGitCommitRefs(
      commit(undefined, "origin/HEAD, HEAD -> main, origin/main, tag: v1"),
      gitContext(),
    );
    const bareHeadPresentation = presentGitCommitRefs(commit(undefined, "remote/HEAD, HEAD"), gitContext());
    const structuredEmptyPresentation = presentGitCommitRefs(commit([], "HEAD -> main"), gitContext());

    expect(legacyPresentation.full.map(({ name, kind, isCurrentHead }) => ({ name, kind, isCurrentHead }))).toEqual([
      { name: "HEAD -> main", kind: "head", isCurrentHead: true },
      { name: "origin/main", kind: "remote", isCurrentHead: false },
      { name: "origin/HEAD", kind: "remote", isCurrentHead: false },
      { name: "tag: v1", kind: "tag", isCurrentHead: false },
    ]);
    expect(bareHeadPresentation.full.map(({ name, kind, label, isCurrentHead }) => ({ name, kind, label, isCurrentHead }))).toEqual([
      { name: "HEAD", kind: "head", label: "HEAD", isCurrentHead: true },
      { name: "remote/HEAD", kind: "remote", label: "remote/HEAD", isCurrentHead: false },
    ]);
    expect(structuredEmptyPresentation.full).toEqual([]);
  });

  it("prefers known local branches to remote-looking legacy names", () => {
    const presentation = presentGitCommitRefs(
      commit(undefined, "origin/topic"),
      gitContext({
        branch: "origin/topic",
        branches: [{ name: "origin/topic", current: true }],
        upstream: null,
      }),
    );

    expect(presentation.full.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "origin/topic", kind: "local" },
    ]);
  });
});