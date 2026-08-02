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
  base: null,
  ...overrides,
});

describe("presentGitCommitRefs", () => {
  it("orders current, upstream, graph-colored, and remaining ref kinds", () => {
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
      gitContext({ graphColorByRefIdentity: { "local:feature/colored": 7 } }),
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
    expect(presentation.full.map((member) => member.priority)).toEqual([0, 1, 3, 4, 4, 5, 5, 6, 6]);
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

  it("folds an attached HEAD into its local branch and keeps every other ref", () => {
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
      gitContext({
        graphColorByRefIdentity: {
          "local:main": 0,
          "remote:origin/main": 0,
          "local:release": 1,
          "remote:fork/topic": 2,
        },
      }),
    );

    expect(presentation.dense.hiddenMembers).toEqual([]);
    expect(
      presentation.full.map(({ name, kind, isCurrentHead, priority }) => ({ name, kind, isCurrentHead, priority })),
    ).toEqual([
      { name: "main", kind: "local", isCurrentHead: true, priority: 0 },
      { name: "origin/main", kind: "remote", isCurrentHead: false, priority: 1 },
      { name: "fork/topic", kind: "remote", isCurrentHead: false, priority: 3 },
      { name: "release", kind: "local", isCurrentHead: false, priority: 3 },
      { name: "origin/HEAD", kind: "remote", isCurrentHead: false, priority: 5 },
      { name: "main", kind: "tag", isCurrentHead: false, priority: 6 },
    ]);
    expect(presentation.full.some((member) => member.name === "HEAD -> main")).toBe(false);
    expect(
      presentation.full.find((member) => member.kind === "tag" && member.name === "main")?.graphColorIndex,
    ).toBeUndefined();
    expect(
      presentation.dense.members.map(({ name, kind, display, memberNames }) => ({ name, kind, display, memberNames })),
    ).toEqual([
      { name: "main", kind: "local", display: "label", memberNames: ["main"] },
      { name: "origin/main", kind: "remote", display: "icon", memberNames: ["origin/main"] },
      { name: "fork/topic", kind: "remote", display: "icon", memberNames: ["fork/topic"] },
      { name: "release", kind: "local", display: "icon", memberNames: ["release"] },
      { name: "origin/HEAD", kind: "remote", display: "icon", memberNames: ["origin/HEAD"] },
      { name: "main", kind: "tag", display: "icon", memberNames: ["main"] },
    ]);
  });

  it("prefers the current base remote as the branch label", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "local", name: "master" },
        { kind: "remote", name: "remote/master" },
        { kind: "remote", name: "origin/HEAD" },
        { kind: "tag", name: "release,annotated" },
      ]),
      gitContext({
        upstream: null,
        base: { remote: "remote", branch: "master", ref: "remote/master" },
        graphColorByRefIdentity: { "remote:remote/master": 1 },
      }),
    );

    expect(presentation.full.map((member) => member.name)).toEqual([
      "remote/master",
      "master",
      "origin/HEAD",
      "release,annotated",
    ]);
    expect(presentation.full[0]).toMatchObject({ isCurrentBase: true, priority: 2 });
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
        name: "remote/master",
        display: "label",
        title: "remote/master",
        memberNames: ["remote/master"],
        memberTitles: ["remote/master"],
      },
      {
        name: "master",
        display: "icon",
        title: "master",
        memberNames: ["master"],
        memberTitles: ["master"],
      },
      {
        name: "origin/HEAD",
        display: "icon",
        title: "origin/HEAD",
        memberNames: ["origin/HEAD"],
        memberTitles: ["origin/HEAD"],
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

  it("groups same-colored secondary refs behind their icon count", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "local", name: "main" },
        { kind: "remote", name: "origin/main" },
        { kind: "remote", name: "fork/topic" },
        { kind: "remote", name: "origin/topic" },
      ]),
      gitContext({
        branch: "feature/current",
        headHash: "another-commit",
        upstream: null,
        base: { remote: "origin", branch: "main", ref: "origin/main" },
        graphColorByRefIdentity: {
          "remote:origin/main": 1,
          "remote:fork/topic": 2,
          "remote:origin/topic": 2,
        },
      }),
    );

    expect(
      presentation.dense.members.map(({ name, display, memberNames }) => ({ name, display, memberNames })),
    ).toEqual([
      { name: "origin/main", display: "label", memberNames: ["origin/main"] },
      { name: "fork/topic", display: "icon", memberNames: ["fork/topic", "origin/topic"] },
      { name: "main", display: "icon", memberNames: ["main"] },
    ]);
  });

  it("keeps an old uncolored branch visible in the compact presentation", () => {
    const presentation = presentGitCommitRefs(
      commit([{ kind: "local", name: "archive/merged-last-year" }], undefined, "old-commit"),
      gitContext({ headHash: "head", graphColorByRefIdentity: { "local:main": 0 } }),
    );

    expect(
      presentation.dense.members.map(({ name, display, memberNames }) => ({ name, display, memberNames })),
    ).toEqual([{ name: "archive/merged-last-year", display: "label", memberNames: ["archive/merged-last-year"] }]);
  });

  it("shows one primary label and icon-only companions for local and remote refs", () => {
    const presentation = presentGitCommitRefs(
      commit([
        { kind: "remote", name: "remote/master" },
        { kind: "local", name: "master" },
        { kind: "remote", name: "remote/HEAD" },
      ]),
      gitContext({
        headHash: "another-commit",
        upstream: null,
        base: { remote: "remote", branch: "master", ref: "remote/master" },
        graphColorByRefIdentity: { "remote:remote/master": 1 },
      }),
    );

    expect(
      presentation.dense.members.map(({ name, kind, display, memberNames }) => ({ name, kind, display, memberNames })),
    ).toEqual([
      { name: "remote/master", kind: "remote", display: "label", memberNames: ["remote/master"] },
      { name: "master", kind: "local", display: "icon", memberNames: ["master"] },
      { name: "remote/HEAD", kind: "remote", display: "icon", memberNames: ["remote/HEAD"] },
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
    expect(
      bareHeadPresentation.full.map(({ name, kind, label, isCurrentHead }) => ({ name, kind, label, isCurrentHead })),
    ).toEqual([
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
