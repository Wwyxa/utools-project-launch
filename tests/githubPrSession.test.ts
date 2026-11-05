import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ProjectStatus, type GithubPrContext, type GithubPullRequestSummary } from "../src/types";
let useStore: typeof import("../src/store/useStore").useStore;

const context: GithubPrContext = {
  baseRemote: "origin", baseBranch: "main", headBranch: "feature", mergeBase: "base",
  commits: [], commitsTruncated: false, totalCommits: 2, nonMergeCommitCount: 2,
  files: [], filesTruncated: false, noisyDiffExcluded: false,
  diffStat: "", diffStatTruncated: false, diff: "", diffTruncated: false,
};
const pullRequest: GithubPullRequestSummary = {
  number: 12, title: "Saved title", body: "Saved body", url: "https://github.com/owner/repo/pull/12",
  isDraft: false, state: "open", baseBranch: "main", headBranch: "feature",
};

function setup() {
  const store = useStore();
  store.projects = [{
    id: "project", name: "Project", path: "C:\\repo", type: "Custom", kind: "custom",
    status: ProjectStatus.STOPPED, scripts: [], env: {}, pathExists: true,
    git: {
      branch: "feature", headHash: "head-1", ahead: 0, behind: 0, files: [], commits: [], commitCount: 0,
      repositoryPath: "C:\\repo", lastRefreshedAt: "now", statusText: "",
      remotes: [{ name: "origin", fetchUrl: "https://github.com/owner/repo.git", pushUrl: "https://github.com/owner/repo.git" }],
      remoteBranches: [{ remote: "origin", branch: "main", ref: "origin/main", commitHash: "base-1" }],
      upstream: { remote: "origin", branch: "feature", ref: "origin/feature", ahead: 0, behind: 0 },
    },
  }];
  const fetch = vi.spyOn(store, "fetchGitRemoteByName").mockResolvedValue(null);
  const metadata = vi.spyOn(store, "readGithubRepositoryMetadata").mockResolvedValue({
    ok: true, value: { owner: "owner", repository: "repo", nodeId: "R_repo", defaultBranch: "main", isFork: false, parent: null },
  });
  const templates = vi.spyOn(store, "readGithubPullRequestTemplates").mockResolvedValue({ ok: true, value: ["Template"] });
  const existing = vi.spyOn(store, "readGithubOpenPullRequest").mockResolvedValue({ ok: true, value: null });
  const readContext = vi.spyOn(store, "readGithubPrContext").mockResolvedValue({ ok: true, value: context });
  return { store, fetch, metadata, templates, existing, readContext, session: store.githubPrSession("project") };
}

beforeEach(async () => {
  vi.stubGlobal("window", {
    navigator: { platform: "", userAgent: "vitest" },
    localStorage: { getItem: () => null, setItem: () => undefined },
    projectBridge: undefined,
  });
  ({ useStore } = await import("../src/store/useStore"));
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHub PR creation sessions", () => {
  it("shares initialization while hidden and keeps results for a new subscriber", async () => {
    const { store, session, fetch, metadata } = setup();
    let finish: () => void = () => undefined;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(null); }));
    const oldFeedback = vi.fn();
    const hide = session.subscribe(oldFeedback);
    const first = session.initialize();
    hide();
    const oldCallCount = oldFeedback.mock.calls.length;
    const newFeedback = vi.fn();
    session.subscribe(newFeedback);
    const reopened = session.initialize();
    expect(reopened).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(newFeedback).toHaveBeenCalledWith("loading", "正在刷新远端分支...", undefined);
    finish();
    await reopened;
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(oldFeedback).toHaveBeenCalledTimes(oldCallCount);
    expect(session.phase.value).toBe("ready");
    session.prDescription.value = "Keep this draft";
    session.descriptionTouched.value = true;
    expect(store.githubPrSession("project")).toBe(session);
    await session.initialize();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.prDescription.value).toBe("Keep this draft");
    session.resetDraft();
    expect(session.prDescription.value).toBe("");
  });

  it("refreshes only commit context when refs change and preserves edits through a failed refresh", async () => {
    const { store, session, fetch, templates, readContext } = setup();
    await session.initialize();
    session.prTitle.value = "Edited";
    session.prDescription.value = "Keep this";
    session.titleTouched.value = session.descriptionTouched.value = true;
    store.projects[0].git!.headHash = "head-2";
    await session.initialize();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(templates).toHaveBeenCalledTimes(1);
    expect(readContext).toHaveBeenCalledTimes(2);
    readContext.mockResolvedValueOnce({ ok: false, value: null, failure: { operation: "history", code: "command-failed", message: "Fetch failed" } });
    await session.initialize(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.prContext.value).toEqual(context);
    expect(session.prTitle.value).toBe("Edited");
    expect(session.prDescription.value).toBe("Keep this");
    expect(session.contextError.value).toBe("Fetch failed");
    expect(session.canCreate.value).toBe(false);
    await session.initialize();
    expect(session.contextError.value).toBe("");
    store.projects[0].git!.headHash = "head-3";
    const previousCalls = readContext.mock.calls.length;
    readContext.mockRejectedValue(new Error("Read unavailable"));
    await session.initialize();
    expect(readContext).toHaveBeenCalledTimes(previousCalls + 1);
    expect(session.phase.value).toBe("ready");
    expect(session.contextError.value).toBe("Read unavailable");
    expect(session.prContext.value).toEqual(context);
  });

  it("rejects a context read whose HEAD changed in flight and fetches the latest context", async () => {
    const { store, session, readContext, fetch } = setup();
    await session.initialize();
    let resolve: (result: Awaited<ReturnType<typeof store.readGithubPrContext>>) => void = () => undefined;
    readContext.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    store.projects[0].git!.headHash = "head-2";
    const pending = session.initialize();
    store.projects[0].git!.headHash = "head-3";
    resolve({ ok: true, value: { ...context, totalCommits: 99 } });
    await pending;
    await session.initialize();
    expect(session.prContext.value?.totalCommits).toBe(2);
    expect(readContext).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clears PR identity when a remote changes even if the new PR lookup fails", async () => {
    const { store, session, metadata, existing } = setup();
    existing.mockResolvedValueOnce({ ok: true, value: pullRequest });
    await session.initialize();
    session.prDescription.value = "Unsaved draft";
    session.descriptionTouched.value = true;
    store.projects[0].git!.remotes![0].fetchUrl = "https://github.com/other/app.git";
    metadata.mockResolvedValue({ ok: true, value: {
      owner: "other", repository: "app", nodeId: "R_other", defaultBranch: "main", isFork: false, parent: null,
    } });
    existing.mockResolvedValue({ ok: false, value: null, failure: { code: "network-error", message: "Offline" } });
    await session.initialize();
    expect(session.openPullRequest.value).toBeNull();
    expect(session.canSavePullRequest.value).toBe(false);
    expect(session.prDescription.value).toBe("Unsaved draft");
    store.clearGithubPrSessions("project");
    expect(store.githubPrSession("project")).not.toBe(session);
  });
});
