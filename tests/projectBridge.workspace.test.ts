import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "../src/lib/projectBridge";
import { gitRepositoryPathsEqual } from "../src/lib/gitRepositoryTarget";
import { ProjectStatus } from "../src/types";
import type {
  Project,
  ProjectBridge,
  ProjectBridgeGitWorkingTreeSnapshot,
  ProjectGitFileChange,
  ProjectGitRemoteBranchSummary,
  ProjectGitSnapshot,
  ProjectGitSubmoduleSummary,
  ProjectGitWorkspaceSnapshot,
  ProjectGitWorktreeSummary,
} from "../src/types";

const workspaceSnapshot = (repositoryPath: string, lastRefreshedAt: string): ProjectGitWorkspaceSnapshot => ({
  repositoryPath,
  objectFormat: "sha1",
  worktrees: { state: "ready", entries: [], failure: null },
  submodules: { state: "ready", entries: [], failure: null },
  lastRefreshedAt,
});

const createDeferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

const createProject = (id: string, projectPath: string): Project => ({
  id,
  name: id,
  path: projectPath,
  type: "Custom",
  kind: "custom",
  status: ProjectStatus.STOPPED,
  scripts: [],
  env: {},
  pathExists: true,
});

const healthyWorktree = (worktreePath: string): ProjectGitWorktreeSummary => ({
  kind: "linked",
  path: worktreePath,
  pathAvailable: true,
  objectFormat: "sha1",
  head: { kind: "branch", ref: "refs/heads/feature", name: "feature", oid: "a".repeat(40) },
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  status: null,
  failure: null,
});

const healthySubmodule = (submodulePath: string): ProjectGitSubmoduleSummary => ({
  name: "module",
  path: submodulePath,
  pathAvailable: true,
  configuration: "configured",
  url: { declared: "../module.git", local: "../module.git", effective: "../module.git" },
  branch: { declared: null, local: null, effective: null },
  index: { kind: "recorded", recordedOid: "b".repeat(40), conflictStages: [] },
  registration: "initialized",
  checkout: "available",
  objectFormat: "sha1",
  head: { kind: "detached", ref: null, name: null, oid: "b".repeat(40) },
  commitMismatch: false,
  status: null,
  failure: null,
});

const gitSnapshot = (
  repositoryPath: string,
  branch: string,
  hash = "c".repeat(40),
  remoteBranches: ProjectGitRemoteBranchSummary[] = [],
): ProjectGitSnapshot => ({
  branch,
  headHash: hash,
  ahead: 0,
  behind: 0,
  files: [],
  commits: [{ hash, message: branch, author: "Tester", date: "2026-07-19T10:00:00.000Z" }],
  commitCount: 1,
  branches: [],
  remotes: [],
  remoteBranches,
  upstream: null,
  base: null,
  hasMoreCommits: false,
  repositoryPath,
  lastRefreshedAt: "2026-07-19T10:00:00.000Z",
  statusText: branch,
});

const workingTreeSnapshot = (
  repositoryPath: string,
  files: ProjectGitFileChange[],
): ProjectBridgeGitWorkingTreeSnapshot => ({
  files,
  repositoryPath,
  lastRefreshedAt: "2026-08-01T10:00:00.000Z",
  statusText: files.length === 0 ? "工作区干净" : `${files.length} 个文件变更`,
});

describe("browser Git workspace fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reports a missing real bridge in production instead of using browser preview", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { projectBridge: undefined });

    expect(() => getProjectBridge()).toThrow("本地桥接加载失败");
  });

  it("compares Windows paths case-insensitively without collapsing absolute roots", () => {
    expect(gitRepositoryPathsEqual("C:\\Workspace\\Repo\\", "c:/workspace/repo")).toBe(true);
    expect(gitRepositoryPathsEqual("\\\\SERVER\\Share\\Repo", "//server/share/repo/")).toBe(true);
    expect(gitRepositoryPathsEqual("C:\\", "c:")).toBe(false);
    expect(gitRepositoryPathsEqual("/", "")).toBe(false);
    expect(gitRepositoryPathsEqual("/Workspace/Repo", "/workspace/repo")).toBe(false);
  });

  it("deduplicates normal refreshes and ignores an older forced response", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const first = createDeferred<ProjectGitWorkspaceSnapshot>();
    const stale = createDeferred<ProjectGitWorkspaceSnapshot>();
    const latest = createDeferred<ProjectGitWorkspaceSnapshot>();
    const stalePath = createDeferred<ProjectGitWorkspaceSnapshot>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>();
    readGitWorkspaceSnapshot
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise)
      .mockReturnValueOnce(stalePath.promise);
    window.projectBridge = { ...getProjectBridge(), readGitWorkspaceSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("project-workspace", "C:\\project")];

    const firstRefresh = store.refreshGitWorkspace("project-workspace");
    const duplicateRefresh = store.refreshGitWorkspace("project-workspace");
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(1);
    first.resolve(workspaceSnapshot("C:\\project", "2026-07-19T10:00:00.000Z"));
    await Promise.all([firstRefresh, duplicateRefresh]);

    const staleRefresh = store.refreshGitWorkspace("project-workspace", { force: true });
    const latestRefresh = store.refreshGitWorkspace("project-workspace", { force: true });
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(3);
    latest.resolve(workspaceSnapshot("C:\\project", "2026-07-19T10:02:00.000Z"));
    await latestRefresh;
    stale.resolve(workspaceSnapshot("C:\\project", "2026-07-19T10:01:00.000Z"));
    await staleRefresh;

    expect(store.gitWorkspaces["project-workspace"]?.lastRefreshedAt).toBe("2026-07-19T10:02:00.000Z");
    expect(store.gitWorkspaceRefreshing["project-workspace"]).toBe(false);

    const stalePathRefresh = store.refreshGitWorkspace("project-workspace", { force: true });
    store.projects[0].path = "C:\\replacement";
    stalePath.resolve(workspaceSnapshot("C:\\project", "2026-07-19T10:03:00.000Z"));
    await stalePathRefresh;
    expect(store.gitWorkspaces["project-workspace"]?.lastRefreshedAt).toBe("2026-07-19T10:02:00.000Z");
  });

  it("preserves a complete snapshot when history reads fail and retries it on interaction", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const initialSnapshot = gitSnapshot(projectPath, "old");
    const freshSnapshot = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const readGitSnapshot = vi
      .fn<ProjectBridge["readGitSnapshot"]>()
      .mockRejectedValueOnce(new Error("simulated history read failure"))
      .mockResolvedValueOnce(freshSnapshot);
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-history-failure", projectPath);
    project.git = initialSnapshot;
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitSnapshot(project.id, { force: true });

    expect(project.git?.branch).toBe("old");
    expect(store.gitRepositoryReadFailures[contextKey]?.history?.message).toContain("simulated history read failure");

    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" });

    expect(readGitSnapshot).toHaveBeenCalledTimes(2);
    expect(project.git?.branch).toBe("fresh");
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("uses working-tree snapshots for discard writes, including failed bulk discards", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const success = { ok: true, message: "discarded" };
    const failure = { ok: false, count: 0, paths: [], message: "discard failed" };
    const discardGitFile = vi.fn<ProjectBridge["discardGitFile"]>(async () => success);
    const discardGitFiles = vi.fn<ProjectBridge["discardGitFiles"]>(async () => failure);
    const readGitWorkingTreeSnapshot = vi
      .fn<ProjectBridge["readGitWorkingTreeSnapshot"]>()
      .mockResolvedValueOnce(workingTreeSnapshot(mainPath, []))
      .mockResolvedValueOnce(
        workingTreeSnapshot(mainPath, [
          { path: "remaining.txt", additions: 1, deletions: 0, status: "UNTRACKED", staged: false, unstaged: true },
        ]),
      );
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>();
    const readGitCommits = vi.fn<ProjectBridge["readGitCommits"]>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-01T10:00:00.000Z"),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      discardGitFile,
      discardGitFiles,
      readGitWorkingTreeSnapshot,
      readGitStatusSnapshot,
      readGitSnapshot,
      readGitCommits,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-discard-writes", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    await expect(store.discardGitFile(project.id, "discarded.txt")).resolves.toEqual(success);
    await expect(store.discardGitFiles(project.id, ["remaining.txt"], { all: true })).resolves.toEqual(failure);

    expect(discardGitFile).toHaveBeenCalledWith(mainPath, "discarded.txt");
    expect(discardGitFiles).toHaveBeenCalledWith(mainPath, ["remaining.txt"], { all: true });
    expect(readGitWorkingTreeSnapshot).toHaveBeenCalledTimes(2);
    expect(readGitWorkingTreeSnapshot.mock.calls.map(([repositoryPath]) => repositoryPath)).toEqual([
      mainPath,
      mainPath,
    ]);
    expect(readGitStatusSnapshot).not.toHaveBeenCalled();
    expect(readGitSnapshot).not.toHaveBeenCalled();
    expect(readGitCommits).not.toHaveBeenCalled();
    expect(project.git?.files).toEqual([
      { path: "remaining.txt", additions: 1, deletions: 0, status: "UNTRACKED", staged: false, unstaged: true },
    ]);
  });

  it("routes writes to the exact authorized repository and keeps main checkout isolated", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const worktreePath = "C:\\project-worktree";
    const submodulePath = "C:\\project\\module";
    const currentWorkspace: ProjectGitWorkspaceSnapshot = {
      ...workspaceSnapshot(mainPath, "2026-07-19T10:00:00.000Z"),
      worktrees: { state: "ready", failure: null, entries: [healthyWorktree(worktreePath)] },
      submodules: { state: "ready", failure: null, entries: [healthySubmodule(submodulePath)] },
    };
    const success = { ok: true, message: "ok" };
    const stageGitFile = vi.fn<ProjectBridge["stageGitFile"]>(async () => success);
    const commitGitStaged = vi.fn<ProjectBridge["commitGitStaged"]>(async () => success);
    const amendGitCommit = vi.fn<ProjectBridge["amendGitCommit"]>(async () => success);
    const undoResult = { ok: true, message: "undone", commitMessage: "restore this draft" };
    const undoLastGitCommit = vi.fn<ProjectBridge["undoLastGitCommit"]>(async () => undoResult);
    const cherryPickGitCommit = vi.fn<ProjectBridge["cherryPickGitCommit"]>(async () => success);
    const revertGitCommit = vi.fn<ProjectBridge["revertGitCommit"]>(async () => success);
    const checkoutGitCommit = vi.fn<ProjectBridge["checkoutGitCommit"]>(async () => success);
    const createGitBranch = vi.fn<ProjectBridge["createGitBranch"]>(async () => success);
    const createGitTag = vi.fn<ProjectBridge["createGitTag"]>(async () => success);
    const renameGitBranch = vi.fn<ProjectBridge["renameGitBranch"]>(async () => success);
    const deleteGitBranch = vi.fn<ProjectBridge["deleteGitBranch"]>(async () => success);
    const checkoutGitRemoteBranch = vi.fn<ProjectBridge["checkoutGitRemoteBranch"]>(async () => success);
    const fetchGitRemoteByName = vi.fn<ProjectBridge["fetchGitRemoteByName"]>(async () => success);
    const publishGitBranch = vi.fn<ProjectBridge["publishGitBranch"]>(async () => success);
    const addGitRemote = vi.fn<ProjectBridge["addGitRemote"]>(async () => success);
    const deleteGitRemoteBranch = vi.fn<ProjectBridge["deleteGitRemoteBranch"]>(async () => success);
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, repositoryPath),
    );
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, repositoryPath === mainPath ? "main" : repositoryPath),
    );
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () => currentWorkspace);
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      commitGitStaged,
      amendGitCommit,
      undoLastGitCommit,
      cherryPickGitCommit,
      revertGitCommit,
      checkoutGitCommit,
      createGitBranch,
      createGitTag,
      renameGitBranch,
      deleteGitBranch,
      checkoutGitRemoteBranch,
      fetchGitRemoteByName,
      publishGitBranch,
      addGitRemote,
      deleteGitRemoteBranch,
      readGitStatusSnapshot,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-writes", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];
    store.gitWorkspaces[project.id] = currentWorkspace;
    const worktreeTarget = { kind: "worktree", path: worktreePath } as const;
    const submoduleTarget = { kind: "submodule", path: submodulePath } as const;

    await store.stageGitFile(project.id, "worktree.txt", worktreeTarget);
    await store.commitGitStaged(project.id, "submodule commit", submoduleTarget);
    await store.amendGitCommit(project.id, "main amend");
    await store.amendGitCommit(project.id, "worktree amend", worktreeTarget);
    await store.cherryPickGitCommit(project.id, "f".repeat(40), worktreeTarget);
    await store.revertGitCommit(project.id, "g".repeat(40), submoduleTarget);
    await store.checkoutGitCommit(project.id, "d".repeat(40), {}, { kind: "main" });
    await store.addGitRemote(project.id, "fork", "../fork.git", worktreeTarget);
    await store.checkoutGitCommit(project.id, "e".repeat(40), {}, worktreeTarget);
    await store.addGitRemote(project.id, "mirror", "../mirror.git", submoduleTarget);
    await store.publishGitBranch(project.id, "mirror", worktreeTarget);
    await store.createGitBranch(project.id, "feature", "a".repeat(40), { checkout: true }, worktreeTarget);
    await store.createGitTag(
      project.id,
      "v1",
      "b".repeat(40),
      { annotated: true, message: "release" },
      submoduleTarget,
    );
    await store.renameGitBranch(project.id, "feature", "renamed", worktreeTarget);
    await store.deleteGitBranch(project.id, "renamed", { force: true }, submoduleTarget);
    await store.checkoutGitRemoteBranch(project.id, "origin/feature", { force: true }, worktreeTarget);
    await store.fetchGitRemoteByName(project.id, "mirror", worktreeTarget);
    await store.deleteGitRemoteBranch(project.id, "mirror", "feature/remote-delete", submoduleTarget);
    const worktreeContext = store.resolveGitRepositoryContext(project.id, worktreeTarget)!;
    store.gitRepositorySnapshots[worktreeContext.contextKey] = gitSnapshot(worktreePath, "stale-worktree");
    const undo = await store.undoLastGitCommit(project.id, { allowMerge: true }, submoduleTarget);

    expect(stageGitFile).toHaveBeenCalledWith(worktreePath, "worktree.txt");
    expect(commitGitStaged).toHaveBeenCalledWith(submodulePath, "submodule commit");
    expect(amendGitCommit).toHaveBeenCalledWith(mainPath, "main amend");
    expect(amendGitCommit).toHaveBeenCalledWith(worktreePath, "worktree amend");
    expect(undoLastGitCommit).toHaveBeenCalledWith(submodulePath, { allowMerge: true });
    expect(cherryPickGitCommit).toHaveBeenCalledWith(worktreePath, "f".repeat(40));
    expect(revertGitCommit).toHaveBeenCalledWith(submodulePath, "g".repeat(40));
    expect(undo).toEqual(undoResult);
    expect(store.gitSnapshotForRepository(project.id, worktreeTarget)).toBeNull();
    expect(checkoutGitCommit.mock.calls[0]?.[0]).toBe(mainPath);
    expect(checkoutGitCommit.mock.calls[0]?.[2]?.preferredBranch).toBe("main");
    expect(checkoutGitCommit.mock.calls[1]?.[0]).toBe(worktreePath);
    expect(addGitRemote).toHaveBeenCalledWith(worktreePath, "fork", "../fork.git");
    expect(addGitRemote).toHaveBeenCalledWith(submodulePath, "mirror", "../mirror.git");
    expect(publishGitBranch).toHaveBeenCalledWith(worktreePath, "mirror");
    expect(createGitBranch).toHaveBeenCalledWith(worktreePath, "feature", "a".repeat(40), { checkout: true });
    expect(createGitTag).toHaveBeenCalledWith(submodulePath, "v1", "b".repeat(40), {
      annotated: true,
      message: "release",
    });
    expect(renameGitBranch).toHaveBeenCalledWith(worktreePath, "feature", "renamed");
    expect(deleteGitBranch).toHaveBeenCalledWith(submodulePath, "renamed", { force: true });
    expect(checkoutGitRemoteBranch).toHaveBeenCalledWith(worktreePath, "origin/feature", { force: true });
    expect(fetchGitRemoteByName).toHaveBeenCalledWith(worktreePath, "mirror");
    expect(deleteGitRemoteBranch).toHaveBeenCalledWith(submodulePath, "mirror", "feature/remote-delete");
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(19);
    expect(store.gitWritesInProgress[project.id]).toBe(0);
  });

  it("rejects a stale target before any Git write reaches the bridge", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const stageGitFile = vi.fn<ProjectBridge["stageGitFile"]>();
    const commitGitStaged = vi.fn<ProjectBridge["commitGitStaged"]>();
    const amendGitCommit = vi.fn<ProjectBridge["amendGitCommit"]>();
    const undoLastGitCommit = vi.fn<ProjectBridge["undoLastGitCommit"]>();
    const cherryPickGitCommit = vi.fn<ProjectBridge["cherryPickGitCommit"]>();
    const revertGitCommit = vi.fn<ProjectBridge["revertGitCommit"]>();
    const checkoutGitCommit = vi.fn<ProjectBridge["checkoutGitCommit"]>();
    const createGitBranch = vi.fn<ProjectBridge["createGitBranch"]>();
    const createGitTag = vi.fn<ProjectBridge["createGitTag"]>();
    const renameGitBranch = vi.fn<ProjectBridge["renameGitBranch"]>();
    const deleteGitBranch = vi.fn<ProjectBridge["deleteGitBranch"]>();
    const checkoutGitRemoteBranch = vi.fn<ProjectBridge["checkoutGitRemoteBranch"]>();
    const fetchGitRemoteByName = vi.fn<ProjectBridge["fetchGitRemoteByName"]>();
    const publishGitBranch = vi.fn<ProjectBridge["publishGitBranch"]>();
    const addGitRemote = vi.fn<ProjectBridge["addGitRemote"]>();
    const deleteGitRemoteBranch = vi.fn<ProjectBridge["deleteGitRemoteBranch"]>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>();
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      commitGitStaged,
      amendGitCommit,
      undoLastGitCommit,
      cherryPickGitCommit,
      revertGitCommit,
      checkoutGitCommit,
      createGitBranch,
      createGitTag,
      renameGitBranch,
      deleteGitBranch,
      checkoutGitRemoteBranch,
      fetchGitRemoteByName,
      publishGitBranch,
      addGitRemote,
      deleteGitRemoteBranch,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("project-stale-write", "C:\\project")];
    const prunablePath = "C:\\prunable-worktree";
    const unreadablePath = "C:\\unreadable-worktree";
    const uninitializedPath = "C:\\project\\uninitialized-module";
    store.gitWorkspaces["project-stale-write"] = {
      ...workspaceSnapshot("C:\\project", "2026-07-19T10:00:00.000Z"),
      worktrees: {
        state: "partial",
        failure: null,
        entries: [
          { ...healthyWorktree(prunablePath), prunable: true, prunableReason: "missing" },
          {
            ...healthyWorktree(unreadablePath),
            failure: { code: "permission-denied", operation: "worktree-status", message: "denied" },
          },
        ],
      },
      submodules: {
        state: "partial",
        failure: null,
        entries: [
          {
            ...healthySubmodule(uninitializedPath),
            registration: "uninitialized",
            checkout: "missing",
            failure: { code: "path-unavailable", operation: "submodule-status", message: "missing" },
          },
        ],
      },
    };
    const staleTarget = { kind: "worktree", path: "C:\\removed-worktree" } as const;

    await expect(store.stageGitFile("project-stale-write", "file.txt", staleTarget)).resolves.toBeNull();
    await expect(
      store.stageGitFile("project-stale-write", "file.txt", { kind: "worktree", path: prunablePath }),
    ).resolves.toBeNull();
    await expect(
      store.stageGitFile("project-stale-write", "file.txt", { kind: "worktree", path: unreadablePath }),
    ).resolves.toBeNull();
    await expect(
      store.stageGitFile("project-stale-write", "file.txt", { kind: "submodule", path: uninitializedPath }),
    ).resolves.toBeNull();
    await expect(store.commitGitStaged("project-stale-write", "message", staleTarget)).resolves.toBeNull();
    await expect(store.amendGitCommit("project-stale-write", "message", staleTarget)).resolves.toBeNull();
    await expect(store.undoLastGitCommit("project-stale-write", {}, staleTarget)).resolves.toBeNull();
    await expect(store.cherryPickGitCommit("project-stale-write", "e".repeat(40), staleTarget)).resolves.toBeNull();
    await expect(store.revertGitCommit("project-stale-write", "e".repeat(40), staleTarget)).resolves.toBeNull();
    await expect(store.checkoutGitCommit("project-stale-write", "e".repeat(40), {}, staleTarget)).resolves.toBeNull();
    await expect(
      store.createGitBranch("project-stale-write", "feature", "e".repeat(40), {}, staleTarget),
    ).resolves.toBeNull();
    await expect(store.createGitTag("project-stale-write", "v1", "e".repeat(40), {}, staleTarget)).resolves.toBeNull();
    await expect(store.renameGitBranch("project-stale-write", "old", "next", staleTarget)).resolves.toBeNull();
    await expect(store.deleteGitBranch("project-stale-write", "old", {}, staleTarget)).resolves.toBeNull();
    await expect(
      store.checkoutGitRemoteBranch("project-stale-write", "origin/feature", {}, staleTarget),
    ).resolves.toBeNull();
    await expect(store.fetchGitRemoteByName("project-stale-write", "origin", staleTarget)).resolves.toBeNull();
    await expect(store.publishGitBranch("project-stale-write", "origin", staleTarget)).resolves.toBeNull();
    await expect(store.addGitRemote("project-stale-write", "fork", "../fork.git", staleTarget)).resolves.toBeNull();
    await expect(
      store.deleteGitRemoteBranch("project-stale-write", "origin", "feature/remote-delete", staleTarget),
    ).resolves.toBeNull();

    store.gitWorkspaces["project-stale-write"] = {
      ...workspaceSnapshot("C:\\project", "2026-07-19T10:01:00.000Z"),
      worktrees: {
        state: "ready",
        failure: null,
        entries: [
          {
            ...healthyWorktree("C:\\project"),
            kind: "bare",
            head: { kind: "bare", ref: null, name: null, oid: "a".repeat(40) },
          },
        ],
      },
    };
    await expect(store.stageGitFile("project-stale-write", "file.txt", { kind: "main" })).resolves.toBeNull();

    expect(stageGitFile).not.toHaveBeenCalled();
    expect(commitGitStaged).not.toHaveBeenCalled();
    expect(amendGitCommit).not.toHaveBeenCalled();
    expect(undoLastGitCommit).not.toHaveBeenCalled();
    expect(cherryPickGitCommit).not.toHaveBeenCalled();
    expect(revertGitCommit).not.toHaveBeenCalled();
    expect(checkoutGitCommit).not.toHaveBeenCalled();
    expect(createGitBranch).not.toHaveBeenCalled();
    expect(createGitTag).not.toHaveBeenCalled();
    expect(renameGitBranch).not.toHaveBeenCalled();
    expect(deleteGitBranch).not.toHaveBeenCalled();
    expect(checkoutGitRemoteBranch).not.toHaveBeenCalled();
    expect(fetchGitRemoteByName).not.toHaveBeenCalled();
    expect(publishGitBranch).not.toHaveBeenCalled();
    expect(addGitRemote).not.toHaveBeenCalled();
    expect(deleteGitRemoteBranch).not.toHaveBeenCalled();
    expect(readGitWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it("serializes history actions for one repository target and rechecks queued targets", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const worktreePath = "C:\\project-worktree";
    let currentWorkspace: ProjectGitWorkspaceSnapshot = {
      ...workspaceSnapshot(mainPath, "2026-08-05T00:00:00.000Z"),
      worktrees: { state: "ready", failure: null, entries: [healthyWorktree(worktreePath)] },
    };
    const firstWrite = createDeferred<{ ok: true; message: string }>();
    const workspaceRefresh = createDeferred<ProjectGitWorkspaceSnapshot>();
    const cherryPickGitCommit = vi.fn<ProjectBridge["cherryPickGitCommit"]>(() => firstWrite.promise);
    const revertGitCommit = vi.fn<ProjectBridge["revertGitCommit"]>(async () => ({ ok: true, message: "reverted" }));
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, "refreshed"),
    );
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(() => workspaceRefresh.promise);
    window.projectBridge = {
      ...getProjectBridge(),
      cherryPickGitCommit,
      revertGitCommit,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-history-action-queue", mainPath);
    const target = { kind: "worktree", path: worktreePath } as const;
    store.projects = [project];
    store.gitWorkspaces[project.id] = currentWorkspace;

    const first = store.cherryPickGitCommit(project.id, "a".repeat(40), target);
    await Promise.resolve();
    await Promise.resolve();
    expect(cherryPickGitCommit).toHaveBeenCalledWith(worktreePath, "a".repeat(40));

    const queued = store.revertGitCommit(project.id, "b".repeat(40), target);
    await Promise.resolve();
    expect(revertGitCommit).not.toHaveBeenCalled();

    firstWrite.resolve({ ok: true, message: "picked" });
    await Promise.resolve();
    await Promise.resolve();
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledOnce();
    expect(revertGitCommit).not.toHaveBeenCalled();

    currentWorkspace = {
      ...currentWorkspace,
      worktrees: { state: "ready", failure: null, entries: [] },
    };
    store.gitWorkspaces[project.id] = currentWorkspace;
    workspaceRefresh.resolve(currentWorkspace);

    await expect(first).resolves.toEqual({ ok: true, message: "picked" });
    await expect(queued).resolves.toBeNull();
    expect(revertGitCommit).not.toHaveBeenCalled();
    expect(store.gitWritesInProgress[project.id]).toBe(0);
  });
});
