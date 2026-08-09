import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "../src/lib/projectBridge";
import { gitRepositoryPathsEqual } from "../src/lib/gitRepositoryTarget";
import { ProjectStatus } from "../src/types";
import type {
  Project,
  ProjectBridge,
  ProjectBridgeGitCommitPage,
  ProjectBridgeGitWorkingTreeSnapshot,
  ProjectGitRepositoryTarget,
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
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reports both sections as unavailable without simulating a local repository", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });

    const [snapshot, workingTree] = await Promise.all([
      getProjectBridge().readGitWorkspaceSnapshot("C:\\preview-only"),
      getProjectBridge().readGitWorkingTreeSnapshot("C:\\preview-only"),
    ]);

    expect(snapshot.repositoryPath).toBe("");
    expect(snapshot.objectFormat).toBeNull();
    expect(snapshot.worktrees).toMatchObject({
      state: "unavailable",
      entries: [],
      failure: { code: "unsupported-output", operation: "repository" },
    });
    expect(snapshot.submodules).toMatchObject({
      state: "unavailable",
      entries: [],
      failure: { code: "unsupported-output", operation: "repository" },
    });
    expect(Number.isNaN(Date.parse(snapshot.lastRefreshedAt))).toBe(false);
    expect(workingTree).toMatchObject({
      files: [],
      repositoryPath: "",
      statusText: "离线预览",
    });
    expect(Number.isNaN(Date.parse(workingTree.lastRefreshedAt))).toBe(false);
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
    const testBridge: ProjectBridge = { ...getProjectBridge(), readGitWorkspaceSnapshot };
    window.projectBridge = testBridge;

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

  it("authorizes only available related repositories from the latest snapshot", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const openExternalApplication = vi.fn<ProjectBridge["openExternalApplication"]>(async (payload) => ({
      launched: true,
      command: "editor",
      cwd: payload.projectPath,
      applicationId: payload.application.id,
      kind: payload.application.kind,
      code: "launched",
    }));
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const testBridge: ProjectBridge = { ...getProjectBridge(), openExternalApplication, pathExists };
    window.projectBridge = testBridge;

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("project-workspace", "C:\\project")];
    store.gitWorkspaces["project-workspace"] = {
      ...workspaceSnapshot("C:\\project", "2026-07-19T10:00:00.000Z"),
      worktrees: {
        state: "ready",
        failure: null,
        entries: [
          {
            kind: "linked",
            path: "C:\\healthy-worktree",
            pathAvailable: true,
            objectFormat: "sha1",
            head: { kind: "branch", ref: "refs/heads/feature", name: "feature", oid: "a".repeat(40) },
            locked: false,
            lockReason: null,
            prunable: false,
            prunableReason: null,
            status: null,
            failure: null,
          },
        ],
      },
      submodules: {
        state: "partial",
        failure: null,
        entries: [
          {
            name: "missing.checkout",
            path: "C:\\empty-submodule-directory",
            pathAvailable: true,
            configuration: "configured",
            url: { declared: "../module.git", local: null, effective: "../module.git" },
            branch: { declared: null, local: null, effective: null },
            index: { kind: "recorded", recordedOid: "b".repeat(40), conflictStages: [] },
            registration: "uninitialized",
            checkout: "missing",
            objectFormat: null,
            head: { kind: "unknown", ref: null, name: null, oid: null },
            commitMismatch: null,
            status: null,
            failure: { code: "path-unavailable", operation: "submodule-status", message: "missing" },
          },
        ],
      },
    };

    await store.openGitRepositoryInEditor("project-workspace", {
      kind: "worktree",
      path: "C:\\arbitrary",
    });
    await store.openGitRepositoryInEditor("project-workspace", {
      kind: "submodule",
      path: "C:\\empty-submodule-directory",
    });
    expect(openExternalApplication).not.toHaveBeenCalled();

    await store.openGitRepositoryInEditor("project-workspace", {
      kind: "worktree",
      path: "C:\\healthy-worktree",
    });
    expect(openExternalApplication).toHaveBeenCalledOnce();
    expect(openExternalApplication.mock.calls[0]?.[0].projectPath).toBe("C:\\healthy-worktree");
    expect(openExternalApplication.mock.calls[0]?.[0].application.id).toBe("vscode");
  });

  it("resolves closed repository targets from the latest workspace snapshot", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("project-workspace", "C:\\project-input")];
    store.gitWorkspaces["project-workspace"] = {
      ...workspaceSnapshot("C:\\Canonical\\Main", "2026-07-19T10:00:00.000Z"),
      worktrees: {
        state: "partial",
        failure: null,
        entries: [
          healthyWorktree("C:\\Worktrees\\Healthy"),
          { ...healthyWorktree("C:\\Worktrees\\Locked"), locked: true, lockReason: "keep" },
          { ...healthyWorktree("C:\\Worktrees\\Prunable"), prunable: true, prunableReason: "missing" },
        ],
      },
      submodules: {
        state: "partial",
        failure: null,
        entries: [
          healthySubmodule("C:\\Canonical\\Main\\module"),
          {
            ...healthySubmodule("C:\\Canonical\\Main\\missing"),
            checkout: "missing",
            failure: { code: "path-unavailable", operation: "submodule-status", message: "missing" },
          },
        ],
      },
    };

    expect(store.resolveGitRepositoryContext("project-workspace", { kind: "main" })).toMatchObject({
      target: { kind: "main" },
      repositoryPath: "C:\\Canonical\\Main",
    });
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "worktree",
        path: "c:\\worktrees\\healthy",
      }),
    ).toMatchObject({
      target: { kind: "worktree", path: "C:\\Worktrees\\Healthy" },
      repositoryPath: "C:\\Worktrees\\Healthy",
    });
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "worktree",
        path: "c:\\worktrees\\locked",
      }),
    ).not.toBeNull();
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "submodule",
        path: "c:\\canonical\\main\\module",
      }),
    ).toMatchObject({ repositoryPath: "C:\\Canonical\\Main\\module" });
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "worktree",
        path: "C:\\Worktrees\\Prunable",
      }),
    ).toBeNull();
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "submodule",
        path: "C:\\Canonical\\Main\\missing",
      }),
    ).toBeNull();
    expect(
      store.resolveGitRepositoryContext("project-workspace", {
        kind: "worktree",
        path: "C:\\arbitrary",
      }),
    ).toBeNull();

    const uncTarget: ProjectGitRepositoryTarget = {
      kind: "worktree",
      path: "\\\\server\\workspace\\repo",
    };
    store.gitWorkspaces["project-workspace"]!.worktrees.entries.push(healthyWorktree("\\\\SERVER\\Workspace\\Repo"));
    expect(store.resolveGitRepositoryContext("project-workspace", uncTarget)).toMatchObject({
      repositoryPath: "\\\\SERVER\\Workspace\\Repo",
    });
  });

  it("skips automatic full Git refreshes only while a snapshot is fresh", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, "refreshed"),
    );
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-fresh-snapshot", "C:\\project");
    project.git = {
      ...gitSnapshot(project.path, "fresh"),
      lastRefreshedAt: new Date().toISOString(),
    };
    store.projects = [project];

    await store.refreshGitSnapshot(project.id, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitSnapshot).not.toHaveBeenCalled();

    project.git = {
      ...project.git,
      lastRefreshedAt: new Date(Date.now() - 15_001).toISOString(),
    };
    await store.refreshGitSnapshot(project.id, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitSnapshot).toHaveBeenCalledTimes(1);
    expect(readGitSnapshot).toHaveBeenLastCalledWith(project.path, { limit: 20, skip: 0 });

    project.git = { ...project.git, lastRefreshedAt: "not-a-date" };
    await store.refreshGitSnapshot(project.id, { maxAgeMs: 15_000 });
    expect(readGitSnapshot).toHaveBeenCalledTimes(2);

    project.git = {
      ...project.git,
      lastRefreshedAt: new Date().toISOString(),
    };
    await store.refreshGitSnapshot(project.id, { force: true, maxAgeMs: 15_000 });
    await store.refreshGitSnapshot(project.id);
    expect(readGitSnapshot).toHaveBeenCalledTimes(4);
  });

  it("uses status-first interaction refreshes for stale snapshots and preserves the requested page limit", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const initialSnapshot = {
      ...gitSnapshot(projectPath, "main", "a".repeat(40)),
      lastRefreshedAt: new Date().toISOString(),
    };
    const unchangedStatus = {
      ...gitSnapshot(projectPath, "main", "a".repeat(40)),
      lastRefreshedAt: new Date().toISOString(),
    };
    const changedStatus = {
      ...gitSnapshot(projectPath, "main", "b".repeat(40)),
      lastRefreshedAt: new Date().toISOString(),
    };
    const refreshedSnapshot = gitSnapshot(projectPath, "main", "b".repeat(40));
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    readGitStatusSnapshot.mockResolvedValueOnce(unchangedStatus).mockResolvedValueOnce(changedStatus);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => refreshedSnapshot);
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot, readGitStatusSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-interaction-refresh", projectPath);
    project.git = initialSnapshot;
    store.projects = [project];

    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" }, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitStatusSnapshot).not.toHaveBeenCalled();
    expect(readGitSnapshot).not.toHaveBeenCalled();

    project.git = {
      ...project.git,
      lastRefreshedAt: new Date(Date.now() - 15_001).toISOString(),
    };
    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" }, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(readGitSnapshot).not.toHaveBeenCalled();

    project.git = {
      ...project.git,
      lastRefreshedAt: new Date(Date.now() - 15_001).toISOString(),
    };
    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" }, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(readGitSnapshot).toHaveBeenCalledTimes(1);
    expect(readGitSnapshot).toHaveBeenLastCalledWith(projectPath, { limit: 20, skip: 0 });

    project.git = null;
    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" }, { maxAgeMs: 15_000, limit: 20 });
    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(readGitSnapshot).toHaveBeenCalledTimes(2);
    expect(readGitSnapshot).toHaveBeenLastCalledWith(projectPath, { limit: 20, skip: 0 });
  });

  it("does not materialize a history snapshot from a status-only refresh", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const statusSnapshot = {
      ...gitSnapshot(projectPath, "main", "a".repeat(40)),
      commits: undefined,
      commitCount: undefined,
    };
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>(async () => statusSnapshot);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () =>
      gitSnapshot(projectPath, "main", "a".repeat(40)),
    );
    window.projectBridge = { ...getProjectBridge(), readGitStatusSnapshot, readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-only", projectPath);
    project.git = null;
    store.projects = [project];

    await store.refreshGitStatusSnapshot(project.id);

    expect(project.git).toBeNull();

    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" }, { limit: 20 });

    expect(readGitSnapshot).toHaveBeenCalledOnce();
    expect(project.git?.commits).toHaveLength(1);
  });

  it("treats a persisted status-only object as incomplete and reloads history", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const incompleteSnapshot = {
      ...gitSnapshot(projectPath, "stale-status"),
      commits: undefined,
      commitCount: undefined,
    } as unknown as ProjectGitSnapshot;
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => gitSnapshot(projectPath, "recovered"));
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-persisted-status-only", projectPath);
    project.git = incompleteSnapshot;
    store.projects = [project];

    expect(store.gitSnapshotForRepository(project.id)).toBeNull();

    await store.refreshGitStatusSnapshot(project.id);

    expect(project.git).toBe(incompleteSnapshot);

    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" });

    expect(readGitSnapshot).toHaveBeenCalledOnce();
    expect(project.git?.branch).toBe("recovered");
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

  it("ignores a stale full-refresh failure after a newer refresh succeeds", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleResult = createDeferred<Awaited<ReturnType<ProjectBridge["readGitSnapshotResult"]>>>();
    const freshSnapshot = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const readGitSnapshotResult = vi.fn<ProjectBridge["readGitSnapshotResult"]>();
    readGitSnapshotResult
      .mockReturnValueOnce(staleResult.promise)
      .mockResolvedValueOnce({ ok: true, value: freshSnapshot });
    window.projectBridge = { ...getProjectBridge(), readGitSnapshotResult };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-stale-full-failure", projectPath);
    project.git = gitSnapshot(projectPath, "old");
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    const staleRefresh = store.refreshGitSnapshot(project.id, { force: true });
    const freshRefresh = store.refreshGitSnapshot(project.id, { force: true });
    await freshRefresh;
    staleResult.resolve({
      ok: false,
      value: null,
      failure: {
        code: "command-failed",
        operation: "history",
        message: "stale history failure",
      },
    });
    await staleRefresh;

    expect(project.git?.branch).toBe("fresh");
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("keeps the previous snapshot when a successful bridge payload is incomplete", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const initialSnapshot = gitSnapshot(projectPath, "old");
    const incompleteSnapshot = {
      ...gitSnapshot(projectPath, "incomplete"),
      commits: undefined,
      commitCount: undefined,
    } as unknown as ProjectGitSnapshot;
    const recoveredSnapshot = gitSnapshot(projectPath, "recovered", "r".repeat(40));
    const readGitSnapshot = vi
      .fn<ProjectBridge["readGitSnapshot"]>()
      .mockResolvedValueOnce(incompleteSnapshot)
      .mockResolvedValueOnce(recoveredSnapshot);
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-incomplete-result", projectPath);
    project.git = initialSnapshot;
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitSnapshot(project.id, { force: true });

    expect(project.git?.branch).toBe("old");
    expect(store.gitRepositoryReadFailures[contextKey]?.history?.code).toBe("invalid-output");

    await store.refreshGitSnapshotForInteraction(project.id, { kind: "main" });

    expect(project.git?.branch).toBe("recovered");
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("preserves history when a status read fails and clears the failure after recovery", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const initialSnapshot = gitSnapshot(projectPath, "old");
    const refreshedStatus = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const readGitStatusSnapshot = vi
      .fn<ProjectBridge["readGitStatusSnapshot"]>()
      .mockRejectedValueOnce(new Error("simulated status read failure"))
      .mockResolvedValueOnce(refreshedStatus);
    window.projectBridge = { ...getProjectBridge(), readGitStatusSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-failure", projectPath);
    project.git = initialSnapshot;
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitStatusSnapshot(project.id);

    expect(project.git?.branch).toBe("old");
    expect(project.git?.commits).toHaveLength(1);
    expect(store.gitRepositoryReadFailures[contextKey]?.status?.message).toContain("simulated status read failure");

    await store.refreshGitStatusSnapshot(project.id);

    expect(project.git?.branch).toBe("fresh");
    expect(project.git?.commits).toHaveLength(1);
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("preserves working-tree files when the lightweight read fails", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleFiles: ProjectGitFileChange[] = [
      { path: "stale.txt", additions: 1, deletions: 0, status: "MODIFIED", unstaged: true },
    ];
    const freshFiles: ProjectGitFileChange[] = [
      { path: "fresh.txt", additions: 2, deletions: 0, status: "ADDED", staged: true },
    ];
    const readGitWorkingTreeSnapshotResult = vi.fn<ProjectBridge["readGitWorkingTreeSnapshotResult"]>();
    readGitWorkingTreeSnapshotResult
      .mockResolvedValueOnce({
        ok: false,
        value: null,
        failure: {
          code: "command-failed",
          operation: "status",
          message: "simulated working-tree failure",
        },
      })
      .mockResolvedValueOnce({ ok: true, value: workingTreeSnapshot(projectPath, freshFiles) });
    window.projectBridge = { ...getProjectBridge(), readGitWorkingTreeSnapshotResult };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-failure", projectPath);
    project.git = { ...gitSnapshot(projectPath, "main"), files: staleFiles };
    store.projects = [project];
    store.stagedFiles[project.id] = staleFiles;
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitWorkingTreeSnapshot(project.id);

    expect(project.git.files).toEqual(staleFiles);
    expect(store.stagedFiles[project.id]).toEqual(staleFiles);
    expect(store.gitRepositoryReadFailures[contextKey]?.status?.message).toContain("working-tree failure");

    await store.refreshGitWorkingTreeSnapshot(project.id);

    expect(project.git.files).toEqual(freshFiles);
    expect(store.stagedFiles[project.id]).toEqual(freshFiles);
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("clears a stale snapshot when a working-tree read reports no repository", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const failure = {
      code: "not-a-repository" as const,
      operation: "repository" as const,
      message: "未检测到 Git 仓库。",
    };
    const readGitWorkingTreeSnapshotResult = vi.fn<ProjectBridge["readGitWorkingTreeSnapshotResult"]>(async () => ({
      ok: false,
      value: null,
      failure,
    }));
    window.projectBridge = { ...getProjectBridge(), readGitWorkingTreeSnapshotResult };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-removed-repository", projectPath);
    project.git = gitSnapshot(projectPath, "stale");
    project.gitLatestCommitAt = project.git.commits[0]?.date;
    store.projects = [project];
    store.stagedFiles[project.id] = [{ path: "stale.txt", additions: 1, deletions: 0, status: "ADDED" }];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitWorkingTreeSnapshot(project.id);

    expect(project.git).toBeNull();
    expect(project.gitLatestCommitAt).toBe("");
    expect(store.stagedFiles[project.id]).toEqual([]);
    expect(store.gitRepositoryReadFailures[contextKey]?.repository).toEqual(failure);
  });

  it("isolates a failed full refresh from other projects in a batch", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const failedPath = "C:\\failed-project";
    const healthyPath = "C:\\healthy-project";
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) => {
      if (repositoryPath === failedPath) {
        throw new Error("failed project history");
      }
      return gitSnapshot(repositoryPath, "healthy");
    });
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const failedProject = createProject("project-batch-failed", failedPath);
    const healthyProject = createProject("project-batch-healthy", healthyPath);
    failedProject.git = null;
    store.projects = [failedProject, healthyProject];

    await Promise.all([
      store.refreshGitSnapshot(failedProject.id, { force: true }),
      store.refreshGitSnapshot(healthyProject.id, { force: true }),
    ]);

    const failedContextKey = store.resolveGitRepositoryContext(failedProject.id)!.contextKey;
    expect(failedProject.git).toBeNull();
    expect(store.gitRepositoryReadFailures[failedContextKey]?.history?.message).toContain("failed project history");
    expect(healthyProject.git?.branch).toBe("healthy");
  });

  it("clears a stale snapshot when the repository no longer exists", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const emptySnapshot = {
      ...gitSnapshot("", "main"),
      commits: [],
      commitCount: 0,
      repositoryPath: "",
      statusText: "未检测到 Git 仓库",
    };
    const failure = {
      code: "not-a-repository" as const,
      operation: "repository" as const,
      message: "未检测到 Git 仓库。",
    };
    const readGitStatusSnapshotResult = vi.fn<ProjectBridge["readGitStatusSnapshotResult"]>(async () => ({
      ok: false,
      value: emptySnapshot,
      failure,
    }));
    const readGitSnapshotResult = vi.fn<ProjectBridge["readGitSnapshotResult"]>(async () => ({
      ok: false,
      value: emptySnapshot,
      failure,
    }));
    const saveProjects = vi.fn<ProjectBridge["saveProjects"]>(async () => undefined);
    window.projectBridge = {
      ...getProjectBridge(),
      readGitSnapshotResult,
      readGitStatusSnapshotResult,
      saveProjects,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-removed-repository", projectPath);
    project.git = gitSnapshot(projectPath, "stale");
    project.gitLatestCommitAt = project.git.commits[0]?.date;
    store.projects = [project];
    store.stagedFiles[project.id] = [{ path: "stale.txt", additions: 1, deletions: 0, status: "ADDED" }];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.refreshGitStatusSnapshot(project.id);

    expect(project.git).toBeNull();
    expect(project.gitLatestCommitAt).toBe("");
    expect(store.stagedFiles[project.id]).toEqual([]);
    expect(store.gitRepositoryReadFailures[contextKey]?.repository).toEqual(failure);
    expect(saveProjects).toHaveBeenCalledTimes(1);
    expect(saveProjects.mock.calls[0]?.[0][0]?.gitLatestCommitAt).toBe("");

    project.git = gitSnapshot(projectPath, "stale-again");
    project.gitLatestCommitAt = project.git.commits[0]?.date;
    store.stagedFiles[project.id] = [{ path: "stale-again.txt", additions: 1, deletions: 0, status: "ADDED" }];

    await store.refreshGitSnapshot(project.id, { force: true });

    expect(project.git).toBeNull();
    expect(project.gitLatestCommitAt).toBe("");
    expect(store.stagedFiles[project.id]).toEqual([]);
    expect(store.gitRepositoryReadFailures[contextKey]?.repository).toEqual(failure);
    expect(saveProjects).toHaveBeenCalledTimes(2);
    expect(saveProjects.mock.calls[1]?.[0][0]?.gitLatestCommitAt).toBe("");
  });

  it("keeps repository removal authoritative over an older full-refresh success", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleFull = createDeferred<Awaited<ReturnType<ProjectBridge["readGitSnapshotResult"]>>>();
    const repositoryFailure = {
      code: "not-a-repository" as const,
      operation: "repository" as const,
      message: "未检测到 Git 仓库。",
    };
    window.projectBridge = {
      ...getProjectBridge(),
      readGitSnapshotResult: vi.fn(() => staleFull.promise),
      readGitStatusSnapshotResult: vi.fn(async () => ({ ok: false, value: null, failure: repositoryFailure })),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-removal-stale-success", projectPath);
    project.git = gitSnapshot(projectPath, "old");
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    const fullRefresh = store.refreshGitSnapshot(project.id, { force: true });
    await store.refreshGitStatusSnapshot(project.id);
    staleFull.resolve({ ok: true, value: gitSnapshot(projectPath, "stale-success") });
    await fullRefresh;

    expect(project.git).toBeNull();
    expect(store.gitRepositoryReadFailures[contextKey]).toEqual({ repository: repositoryFailure });
  });

  it("keeps repository removal authoritative over an older full-refresh failure", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleFull = createDeferred<Awaited<ReturnType<ProjectBridge["readGitSnapshotResult"]>>>();
    const repositoryFailure = {
      code: "not-a-repository" as const,
      operation: "repository" as const,
      message: "未检测到 Git 仓库。",
    };
    window.projectBridge = {
      ...getProjectBridge(),
      readGitSnapshotResult: vi.fn(() => staleFull.promise),
      readGitStatusSnapshotResult: vi.fn(async () => ({ ok: false, value: null, failure: repositoryFailure })),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-removal-stale-failure", projectPath);
    project.git = gitSnapshot(projectPath, "old");
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    const fullRefresh = store.refreshGitSnapshot(project.id, { force: true });
    await store.refreshGitStatusSnapshot(project.id);
    staleFull.resolve({
      ok: false,
      value: null,
      failure: { code: "command-failed", operation: "history", message: "stale full failure" },
    });
    await fullRefresh;

    expect(project.git).toBeNull();
    expect(store.gitRepositoryReadFailures[contextKey]).toEqual({ repository: repositoryFailure });
  });

  it("clears Git state when an existing project path changes", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const bridge = getProjectBridge();
    window.projectBridge = {
      ...bridge,
      pathExists: vi.fn(async () => true),
      listProjectSubdirectories: vi.fn(async () => []),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-path-change", "C:\\old-project");
    project.scripts = [{ id: "script-start", name: "start", command: "npm start", status: "IDLE" }];
    project.git = gitSnapshot(project.path, "old");
    project.gitLatestCommitAt = project.git.commits[0]?.date;
    store.projects = [project];
    store.stagedFiles[project.id] = [
      { path: "old.txt", additions: 1, deletions: 0, status: "MODIFIED", unstaged: true },
    ];
    store.gitWorkspaces[project.id] = workspaceSnapshot(project.path, "2026-08-05T00:00:00.000Z");
    const oldContextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;
    store.gitRepositorySnapshots[oldContextKey] = gitSnapshot(project.path, "old-secondary");
    store.gitRepositoryReadFailures[oldContextKey] = {
      history: { code: "command-failed", operation: "history", message: "old failure" },
    };
    store.gitRefreshing[project.id] = true;
    store.gitStatusRefreshing[project.id] = true;

    store.openEditProjectForm(project.id);
    store.updateProjectForm({ path: "C:\\new-project" });
    await store.saveProjectForm();

    const updatedProject = store.projects.find((item) => item.id === project.id)!;
    expect(updatedProject.path).toBe("C:\\new-project");
    expect(updatedProject.git).toBeNull();
    expect(updatedProject.gitLatestCommitAt).toBe("");
    expect(store.stagedFiles[project.id]).toEqual([]);
    expect(store.gitWorkspaces[project.id]).toBeUndefined();
    expect(store.gitRepositorySnapshots[oldContextKey]).toBeUndefined();
    expect(store.gitRepositoryReadFailures[oldContextKey]).toBeUndefined();
    expect(store.gitRefreshing[project.id]).toBeUndefined();
    expect(store.gitStatusRefreshing[project.id]).toBeUndefined();
  });

  it("ignores an old status failure after the project path changes away and back", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleStatus = createDeferred<Awaited<ReturnType<ProjectBridge["readGitStatusSnapshotResult"]>>>();
    const freshStatus = createDeferred<Awaited<ReturnType<ProjectBridge["readGitStatusSnapshotResult"]>>>();
    const bridge = getProjectBridge();
    const readGitStatusSnapshotResult = vi.fn<ProjectBridge["readGitStatusSnapshotResult"]>();
    readGitStatusSnapshotResult.mockReturnValueOnce(staleStatus.promise).mockReturnValueOnce(freshStatus.promise);
    window.projectBridge = {
      ...bridge,
      pathExists: vi.fn(async () => true),
      listProjectSubdirectories: vi.fn(async () => []),
      readGitStatusSnapshotResult,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-path-reset", projectPath);
    project.scripts = [{ id: "script-start", name: "start", command: "npm start", status: "IDLE" }];
    project.git = gitSnapshot(projectPath, "old");
    store.projects = [project];

    const staleRefresh = store.refreshGitStatusSnapshot(project.id);
    store.openEditProjectForm(project.id);
    store.updateProjectForm({ path: "C:\\other-project" });
    await store.saveProjectForm();
    store.openEditProjectForm(project.id);
    store.updateProjectForm({ path: projectPath });
    await store.saveProjectForm();

    const currentProject = store.projects.find((item) => item.id === project.id)!;
    currentProject.git = gitSnapshot(projectPath, "current");
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;
    const freshRefresh = store.refreshGitStatusSnapshot(project.id);

    staleStatus.resolve({
      ok: false,
      value: null,
      failure: { code: "command-failed", operation: "status", message: "stale status failure" },
    });
    await staleRefresh;

    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
    expect(store.gitStatusRefreshing[project.id]).toBe(true);

    freshStatus.resolve({ ok: true, value: gitSnapshot(projectPath, "fresh") });
    await freshRefresh;

    expect(currentProject.git?.branch).toBe("fresh");
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
    expect(store.gitStatusRefreshing[project.id]).toBe(false);
  });

  it("ignores an old status success after the project path changes away and back", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const staleStatus = createDeferred<Awaited<ReturnType<ProjectBridge["readGitStatusSnapshotResult"]>>>();
    const freshStatus = createDeferred<Awaited<ReturnType<ProjectBridge["readGitStatusSnapshotResult"]>>>();
    const bridge = getProjectBridge();
    const readGitStatusSnapshotResult = vi.fn<ProjectBridge["readGitStatusSnapshotResult"]>();
    readGitStatusSnapshotResult.mockReturnValueOnce(staleStatus.promise).mockReturnValueOnce(freshStatus.promise);
    window.projectBridge = {
      ...bridge,
      pathExists: vi.fn(async () => true),
      listProjectSubdirectories: vi.fn(async () => []),
      readGitStatusSnapshotResult,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-success-path-reset", projectPath);
    project.scripts = [{ id: "script-start", name: "start", command: "npm start", status: "IDLE" }];
    project.git = gitSnapshot(projectPath, "old");
    store.projects = [project];

    const staleRefresh = store.refreshGitStatusSnapshot(project.id);
    store.openEditProjectForm(project.id);
    store.updateProjectForm({ path: "C:\\other-project" });
    await store.saveProjectForm();
    store.openEditProjectForm(project.id);
    store.updateProjectForm({ path: projectPath });
    await store.saveProjectForm();

    const currentProject = store.projects.find((item) => item.id === project.id)!;
    currentProject.git = gitSnapshot(projectPath, "current");
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;
    const freshRefresh = store.refreshGitStatusSnapshot(project.id);

    staleStatus.resolve({ ok: true, value: gitSnapshot(projectPath, "stale") });
    await staleRefresh;

    expect(currentProject.git?.branch).toBe("current");
    expect(store.gitStatusRefreshing[project.id]).toBe(true);

    freshStatus.resolve({
      ok: false,
      value: null,
      failure: { code: "command-failed", operation: "status", message: "fresh status failure" },
    });
    await freshRefresh;

    expect(currentProject.git?.branch).toBe("current");
    expect(store.gitRepositoryReadFailures[contextKey]?.status?.message).toBe("fresh status failure");
    expect(store.gitStatusRefreshing[project.id]).toBe(false);
  });

  it("updates remote tracking branches during status refresh, including an empty prune result", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const remoteBranches: ProjectGitRemoteBranchSummary[] = [
      { remote: "origin", branch: "feature/login", ref: "origin/feature/login" },
    ];
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    readGitStatusSnapshot
      .mockResolvedValueOnce(gitSnapshot(projectPath, "with-remote", "c".repeat(40), remoteBranches))
      .mockResolvedValueOnce(gitSnapshot(projectPath, "pruned", "d".repeat(40), []));
    window.projectBridge = { ...getProjectBridge(), readGitStatusSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-remote-status", projectPath);
    project.git = gitSnapshot(projectPath, "initial", "a".repeat(40), remoteBranches);
    store.projects = [project];

    await store.refreshGitStatusSnapshot(project.id);
    expect(project.git?.remoteBranches).toEqual(remoteBranches);

    await store.refreshGitStatusSnapshot(project.id);
    expect(project.git?.remoteBranches).toEqual([]);
  });

  it("rejects an in-flight commit page after a same-length full refresh", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const stalePage = createDeferred<ProjectBridgeGitCommitPage>();
    const freshSnapshot = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const readGitCommits = vi.fn<ProjectBridge["readGitCommits"]>(() => stalePage.promise);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => freshSnapshot);
    window.projectBridge = { ...getProjectBridge(), readGitCommits, readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-refresh-pagination", projectPath);
    project.git = { ...gitSnapshot(projectPath, "old", "a".repeat(40)), hasMoreCommits: true };
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    const loadMore = store.loadMoreGitCommits(project.id);
    expect(store.gitRepositoryLoadingMore[contextKey]).toBe(true);
    await store.refreshGitSnapshot(project.id, { force: true });

    expect(store.gitRepositoryLoadingMore[contextKey]).toBe(false);
    stalePage.resolve({
      commits: [gitSnapshot(projectPath, "stale-page", "b".repeat(40)).commits[0]],
      commitCount: 1,
      hasMoreCommits: false,
      repositoryPath: projectPath,
      lastRefreshedAt: "2026-08-02T00:00:00.000Z",
    });
    await loadMore;

    expect(project.git?.commits.map((commit) => commit.hash)).toEqual([freshSnapshot.commits[0].hash]);
  });

  it("ignores a cancelled load-more failure after a full refresh succeeds", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const stalePageResult = createDeferred<Awaited<ReturnType<ProjectBridge["readGitCommitsResult"]>>>();
    const freshSnapshot = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const readGitCommitsResult = vi.fn<ProjectBridge["readGitCommitsResult"]>(() => stalePageResult.promise);
    const readGitSnapshotResult = vi.fn<ProjectBridge["readGitSnapshotResult"]>(async () => ({
      ok: true,
      value: freshSnapshot,
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      readGitCommitsResult,
      readGitSnapshotResult,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-cancelled-page-failure", projectPath);
    project.git = { ...gitSnapshot(projectPath, "old"), hasMoreCommits: true };
    store.projects = [project];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    const loadMore = store.loadMoreGitCommits(project.id);
    await store.refreshGitSnapshot(project.id, { force: true });
    stalePageResult.resolve({
      ok: false,
      value: null,
      failure: {
        code: "command-failed",
        operation: "history",
        message: "stale page failure",
      },
    });
    await loadMore;

    expect(project.git?.branch).toBe("fresh");
    expect(store.gitRepositoryReadFailures[contextKey]).toBeUndefined();
  });

  it("clears a stale snapshot when pagination reports no repository", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const failure = {
      code: "not-a-repository" as const,
      operation: "repository" as const,
      message: "未检测到 Git 仓库。",
    };
    const readGitCommitsResult = vi.fn<ProjectBridge["readGitCommitsResult"]>(async () => ({
      ok: false,
      value: null,
      failure,
    }));
    window.projectBridge = { ...getProjectBridge(), readGitCommitsResult };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-pagination-removed-repository", projectPath);
    project.git = { ...gitSnapshot(projectPath, "stale"), hasMoreCommits: true };
    project.gitLatestCommitAt = project.git.commits[0]?.date;
    store.projects = [project];
    store.stagedFiles[project.id] = [{ path: "stale.txt", additions: 1, deletions: 0, status: "ADDED" }];
    const contextKey = store.resolveGitRepositoryContext(project.id)!.contextKey;

    await store.loadMoreGitCommits(project.id);

    expect(project.git).toBeNull();
    expect(project.gitLatestCommitAt).toBe("");
    expect(store.stagedFiles[project.id]).toEqual([]);
    expect(store.gitRepositoryReadFailures[contextKey]?.repository).toEqual(failure);
  });

  it("waits for an in-flight full refresh before loading from a stash-expanded commit page", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const projectPath = "C:\\project";
    const pendingSnapshot = createDeferred<ProjectGitSnapshot>();
    const baseSnapshot = gitSnapshot(projectPath, "fresh", "f".repeat(40));
    const freshSnapshot = {
      ...baseSnapshot,
      commits: [
        {
          ...baseSnapshot.commits[0]!,
          hash: "s".repeat(40),
          message: "stash",
          refNames: [{ kind: "stash" as const, name: "stash@{0}" }],
        },
        baseSnapshot.commits[0]!,
      ],
      hasMoreCommits: true,
      nextCommitSkip: 1,
    };
    const freshPage = gitSnapshot(projectPath, "fresh-page", "b".repeat(40)).commits[0];
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(() => pendingSnapshot.promise);
    const readGitCommits = vi.fn<ProjectBridge["readGitCommits"]>(async () => ({
      commits: [freshPage],
      commitCount: 1,
      hasMoreCommits: false,
      repositoryPath: projectPath,
      lastRefreshedAt: "2026-08-02T00:00:00.000Z",
    }));
    window.projectBridge = { ...getProjectBridge(), readGitCommits, readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-refresh-before-pagination", projectPath);
    project.git = { ...gitSnapshot(projectPath, "old", "a".repeat(40)), hasMoreCommits: true };
    store.projects = [project];

    const refresh = store.refreshGitSnapshot(project.id, { force: true });
    const loadMore = store.loadMoreGitCommits(project.id);

    expect(readGitCommits).not.toHaveBeenCalled();
    pendingSnapshot.resolve(freshSnapshot);
    await refresh;
    await loadMore;

    expect(readGitCommits).toHaveBeenCalledWith(projectPath, { limit: 80, skip: 1 });
    expect(project.git?.commits.map((commit) => commit.hash)).toEqual([
      "s".repeat(40),
      baseSnapshot.commits[0]!.hash,
      freshPage.hash,
    ]);
  });

  it("isolates full snapshots and deduplication by repository context", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const worktreePath = "C:\\project-worktree";
    const submodulePath = "C:\\project\\module";
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, repositoryPath),
    );
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("project-contexts", "C:\\project")];
    store.gitWorkspaces["project-contexts"] = {
      ...workspaceSnapshot("C:\\project", "2026-07-19T10:00:00.000Z"),
      worktrees: { state: "ready", failure: null, entries: [healthyWorktree(worktreePath)] },
      submodules: { state: "ready", failure: null, entries: [healthySubmodule(submodulePath)] },
    };
    const worktreeTarget = { kind: "worktree", path: worktreePath } as const;
    const submoduleTarget = { kind: "submodule", path: submodulePath } as const;

    await Promise.all([
      store.refreshGitSnapshot("project-contexts"),
      store.refreshGitSnapshot("project-contexts", {}, worktreeTarget),
      store.refreshGitSnapshot("project-contexts", {}, worktreeTarget),
      store.refreshGitSnapshot("project-contexts", {}, submoduleTarget),
    ]);

    expect(readGitSnapshot.mock.calls.map(([repositoryPath]) => repositoryPath)).toEqual([
      "C:\\project",
      worktreePath,
      submodulePath,
    ]);
    expect(store.gitSnapshotForRepository("project-contexts")?.repositoryPath).toBe("C:\\project");
    expect(store.gitSnapshotForRepository("project-contexts", worktreeTarget)?.repositoryPath).toBe(worktreePath);
    expect(store.gitSnapshotForRepository("project-contexts", submoduleTarget)?.repositoryPath).toBe(submodulePath);
    expect(store.gitSnapshotForRepository("project-contexts")?.commits[0]?.hash).toBe(
      store.gitSnapshotForRepository("project-contexts", worktreeTarget)?.commits[0]?.hash,
    );
    expect(Object.keys(store.gitRepositorySnapshots)).toHaveLength(2);
  });

  it("drops a related full snapshot when its latest authorization disappears", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const pending = createDeferred<ProjectGitSnapshot>();
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(() => pending.promise);
    window.projectBridge = { ...getProjectBridge(), readGitSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const worktreePath = "C:\\stale-worktree";
    store.projects = [createProject("project-stale", "C:\\project")];
    store.gitWorkspaces["project-stale"] = {
      ...workspaceSnapshot("C:\\project", "2026-07-19T10:00:00.000Z"),
      worktrees: { state: "ready", failure: null, entries: [healthyWorktree(worktreePath)] },
    };
    const target = { kind: "worktree", path: worktreePath } as const;
    const refresh = store.refreshGitSnapshot("project-stale", {}, target);

    store.gitWorkspaces["project-stale"] = {
      ...store.gitWorkspaces["project-stale"]!,
      worktrees: { state: "ready", failure: null, entries: [] },
    };
    pending.resolve(gitSnapshot(worktreePath, "stale"));
    await refresh;

    expect(readGitSnapshot).toHaveBeenCalledOnce();
    expect(store.gitSnapshotForRepository("project-stale", target)).toBeNull();
    expect(Object.keys(store.gitRepositorySnapshots)).toHaveLength(0);
  });

  it("rejects an old related full snapshot after another checkout changes shared refs", async () => {
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
    const pendingSubmoduleRefresh = createDeferred<ProjectGitSnapshot>();
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>((repositoryPath) =>
      repositoryPath === submodulePath
        ? pendingSubmoduleRefresh.promise
        : Promise.resolve(gitSnapshot(repositoryPath, repositoryPath)),
    );
    const commitGitStaged = vi.fn<ProjectBridge["commitGitStaged"]>(async () => ({ ok: true, message: "ok" }));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () => currentWorkspace);
    window.projectBridge = {
      ...getProjectBridge(),
      commitGitStaged,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-ref-race", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];
    store.gitWorkspaces[project.id] = currentWorkspace;
    const worktreeTarget = { kind: "worktree", path: worktreePath } as const;
    const submoduleTarget = { kind: "submodule", path: submodulePath } as const;
    store.gitRepositorySnapshots[store.resolveGitRepositoryContext(project.id, submoduleTarget)!.contextKey] =
      gitSnapshot(submodulePath, "current-submodule-status");

    const staleRefresh = store.refreshGitSnapshot(project.id, { force: true }, submoduleTarget);
    await store.commitGitStaged(project.id, "advance shared refs", worktreeTarget);
    pendingSubmoduleRefresh.resolve(gitSnapshot(submodulePath, "stale-submodule-history"));
    await staleRefresh;

    expect(commitGitStaged).toHaveBeenCalledWith(worktreePath, "advance shared refs");
    expect(store.gitSnapshotForRepository(project.id, submoduleTarget)).toBeNull();
  });

  it("retries a related status read when another checkout changes shared refs", async () => {
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
    const pendingStatus = createDeferred<ProjectGitSnapshot>();
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    readGitStatusSnapshot
      .mockReturnValueOnce(pendingStatus.promise)
      .mockResolvedValueOnce(gitSnapshot(submodulePath, "fresh-submodule-status"));
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, repositoryPath),
    );
    const commitGitStaged = vi.fn<ProjectBridge["commitGitStaged"]>(async () => ({ ok: true, message: "ok" }));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () => currentWorkspace);
    window.projectBridge = {
      ...getProjectBridge(),
      commitGitStaged,
      readGitSnapshot,
      readGitStatusSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-race", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];
    store.gitWorkspaces[project.id] = currentWorkspace;
    const worktreeTarget = { kind: "worktree", path: worktreePath } as const;
    const submoduleTarget = { kind: "submodule", path: submodulePath } as const;
    const submoduleContextKey = store.resolveGitRepositoryContext(project.id, submoduleTarget)!.contextKey;
    store.gitRepositorySnapshots[submoduleContextKey] = gitSnapshot(submodulePath, "current-submodule-status");

    const staleStatusRefresh = store.refreshGitStatusSnapshot(project.id, submoduleTarget);
    await store.commitGitStaged(project.id, "advance shared refs", worktreeTarget);
    pendingStatus.resolve(gitSnapshot(submodulePath, "stale-submodule-status"));
    await staleStatusRefresh;

    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(store.gitSnapshotForRepository(project.id, submoduleTarget)?.branch).toBe("fresh-submodule-status");
  });

  it("uses working-tree snapshots for selected and all stage actions without awaiting workspace inventory", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const currentWorkspace = workspaceSnapshot(mainPath, "2026-08-01T10:00:00.000Z");
    const pendingWorkspace = createDeferred<ProjectGitWorkspaceSnapshot>();
    const success = { ok: true, message: "ok" };
    const stageGitFile = vi.fn<ProjectBridge["stageGitFile"]>(async () => success);
    const unstageGitFile = vi.fn<ProjectBridge["unstageGitFile"]>(async () => success);
    const stageGitFiles = vi.fn<ProjectBridge["stageGitFiles"]>(async () => success);
    const unstageGitFiles = vi.fn<ProjectBridge["unstageGitFiles"]>(async () => success);
    const readGitWorkingTreeSnapshot = vi.fn<ProjectBridge["readGitWorkingTreeSnapshot"]>();
    readGitWorkingTreeSnapshot
      .mockResolvedValueOnce(
        workingTreeSnapshot(mainPath, [
          { path: "selected.txt", additions: 2, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
        ]),
      )
      .mockResolvedValueOnce(
        workingTreeSnapshot(mainPath, [
          { path: "selected.txt", additions: 2, deletions: 0, status: "MODIFIED", staged: false, unstaged: true },
        ]),
      )
      .mockResolvedValueOnce(
        workingTreeSnapshot(mainPath, [
          { path: "first.txt", additions: 1, deletions: 0, status: "ADDED", staged: true, unstaged: false },
          { path: "second.txt", additions: 1, deletions: 0, status: "ADDED", staged: true, unstaged: false },
        ]),
      )
      .mockResolvedValueOnce(
        workingTreeSnapshot(mainPath, [
          { path: "first.txt", additions: 1, deletions: 0, status: "ADDED", staged: false, unstaged: true },
          { path: "second.txt", additions: 1, deletions: 0, status: "ADDED", staged: false, unstaged: true },
        ]),
      );
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>();
    const readGitCommits = vi.fn<ProjectBridge["readGitCommits"]>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(() => pendingWorkspace.promise);
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      unstageGitFile,
      stageGitFiles,
      unstageGitFiles,
      readGitWorkingTreeSnapshot,
      readGitStatusSnapshot,
      readGitSnapshot,
      readGitCommits,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-writes", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    await expect(store.stageGitFile(project.id, "selected.txt")).resolves.toEqual(success);
    expect(store.gitWorkspaceRefreshing[project.id]).toBe(true);
    expect(project.git?.files).toEqual([
      { path: "selected.txt", additions: 2, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
    ]);
    await expect(store.unstageGitFile(project.id, "selected.txt")).resolves.toEqual(success);
    await expect(store.stageGitFiles(project.id, ["first.txt", "second.txt"], { all: true })).resolves.toEqual(success);
    await expect(store.unstageGitFiles(project.id, ["first.txt", "second.txt"], { all: true })).resolves.toEqual(
      success,
    );

    expect(stageGitFile).toHaveBeenCalledWith(mainPath, "selected.txt");
    expect(unstageGitFile).toHaveBeenCalledWith(mainPath, "selected.txt");
    expect(stageGitFiles).toHaveBeenCalledWith(mainPath, ["first.txt", "second.txt"], { all: true });
    expect(unstageGitFiles).toHaveBeenCalledWith(mainPath, ["first.txt", "second.txt"], { all: true });
    expect(readGitWorkingTreeSnapshot).toHaveBeenCalledTimes(4);
    expect(readGitWorkingTreeSnapshot.mock.calls.map(([repositoryPath]) => repositoryPath)).toEqual([
      mainPath,
      mainPath,
      mainPath,
      mainPath,
    ]);
    expect(readGitStatusSnapshot).not.toHaveBeenCalled();
    expect(readGitSnapshot).not.toHaveBeenCalled();
    expect(readGitCommits).not.toHaveBeenCalled();
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(4);
    expect(project.git?.files).toEqual([
      { path: "first.txt", additions: 1, deletions: 0, status: "ADDED", staged: false, unstaged: true },
      { path: "second.txt", additions: 1, deletions: 0, status: "ADDED", staged: false, unstaged: true },
    ]);

    pendingWorkspace.resolve(currentWorkspace);
  });

  it("routes stash writes through full snapshots and refreshes after a failed apply", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const success = { ok: true, message: "ok" };
    const conflicted = { ok: false, message: "conflict" };
    const createGitStash = vi.fn<ProjectBridge["createGitStash"]>(async () => success);
    const applyGitStash = vi.fn<ProjectBridge["applyGitStash"]>(async () => conflicted);
    const popGitStash = vi.fn<ProjectBridge["popGitStash"]>(async () => success);
    const dropGitStash = vi.fn<ProjectBridge["dropGitStash"]>(async () => success);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, "main"),
    );
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async (repositoryPath) =>
      workspaceSnapshot(repositoryPath, "2026-08-03T00:00:00.000Z"),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      createGitStash,
      applyGitStash,
      popGitStash,
      dropGitStash,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-stash-writes", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    await expect(store.createGitStash(project.id, "before refactor", { includeUntracked: true })).resolves.toEqual(
      success,
    );
    await expect(store.applyGitStash(project.id, "stash@{0}")).resolves.toEqual(conflicted);
    await expect(store.popGitStash(project.id, "stash@{0}")).resolves.toEqual(success);
    await expect(store.dropGitStash(project.id, "stash@{0}")).resolves.toEqual(success);

    expect(createGitStash).toHaveBeenCalledWith(mainPath, "before refactor", { includeUntracked: true });
    expect(applyGitStash).toHaveBeenCalledWith(mainPath, "stash@{0}");
    expect(popGitStash).toHaveBeenCalledWith(mainPath, "stash@{0}");
    expect(dropGitStash).toHaveBeenCalledWith(mainPath, "stash@{0}");
    expect(readGitSnapshot).toHaveBeenCalledTimes(4);
    expect(readGitSnapshot.mock.calls.map(([repositoryPath]) => repositoryPath)).toEqual([
      mainPath,
      mainPath,
      mainPath,
      mainPath,
    ]);
  });

  it("drops working-tree results after their repository context becomes stale", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const worktreePath = "C:\\project-worktree";
    const pending = createDeferred<ProjectBridgeGitWorkingTreeSnapshot>();
    const readGitWorkingTreeSnapshot = vi.fn<ProjectBridge["readGitWorkingTreeSnapshot"]>(() => pending.promise);
    window.projectBridge = { ...getProjectBridge(), readGitWorkingTreeSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-stale-working-tree", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];
    store.gitWorkspaces[project.id] = {
      ...workspaceSnapshot(mainPath, "2026-08-01T10:00:00.000Z"),
      worktrees: { state: "ready", failure: null, entries: [healthyWorktree(worktreePath)] },
    };
    const target = { kind: "worktree", path: worktreePath } as const;
    const context = store.resolveGitRepositoryContext(project.id, target)!;
    store.gitRepositorySnapshots[context.contextKey] = gitSnapshot(worktreePath, "current");

    const refresh = store.refreshGitWorkingTreeSnapshot(project.id, target);
    store.gitWorkspaces[project.id] = {
      ...store.gitWorkspaces[project.id]!,
      worktrees: { state: "ready", failure: null, entries: [] },
    };
    pending.resolve(
      workingTreeSnapshot(worktreePath, [
        { path: "stale.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
      ]),
    );
    await refresh;

    expect(store.gitRepositorySnapshots[context.contextKey]?.files).toEqual([]);
  });

  it("retries a working-tree read after a later write mutation", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const stale = createDeferred<ProjectBridgeGitWorkingTreeSnapshot>();
    const fresh = createDeferred<ProjectBridgeGitWorkingTreeSnapshot>();
    const readGitWorkingTreeSnapshot = vi.fn<ProjectBridge["readGitWorkingTreeSnapshot"]>();
    readGitWorkingTreeSnapshot.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const stageGitFile = vi.fn<ProjectBridge["stageGitFile"]>(async () => ({ ok: true, message: "ok" }));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-01T10:00:00.000Z"),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      readGitWorkingTreeSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-mutation", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    const initialRefresh = store.refreshGitWorkingTreeSnapshot(project.id);
    const write = store.stageGitFile(project.id, "fresh.txt");
    await vi.waitFor(() => expect(readGitWorkspaceSnapshot).toHaveBeenCalledOnce());
    stale.resolve(
      workingTreeSnapshot(mainPath, [
        { path: "stale.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
      ]),
    );
    await vi.waitFor(() => expect(readGitWorkingTreeSnapshot).toHaveBeenCalledTimes(2));
    expect(project.git?.files).toEqual([]);
    fresh.resolve(
      workingTreeSnapshot(mainPath, [
        { path: "fresh.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
      ]),
    );
    await Promise.all([initialRefresh, write]);

    expect(project.git?.files).toEqual([
      { path: "fresh.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
    ]);
  });

  it("retries a failed working-tree read after a later write mutation", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const stale = createDeferred<Awaited<ReturnType<ProjectBridge["readGitWorkingTreeSnapshotResult"]>>>();
    const freshFiles: ProjectGitFileChange[] = [
      { path: "fresh.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
    ];
    const readGitWorkingTreeSnapshotResult = vi.fn<ProjectBridge["readGitWorkingTreeSnapshotResult"]>();
    readGitWorkingTreeSnapshotResult
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ ok: true, value: workingTreeSnapshot(mainPath, freshFiles) });
    const stageGitFile = vi.fn<ProjectBridge["stageGitFile"]>(async () => ({ ok: true, message: "ok" }));
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      readGitWorkingTreeSnapshotResult,
      readGitWorkspaceSnapshot: vi.fn(async () => workspaceSnapshot(mainPath, "2026-08-01T10:00:00.000Z")),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-failure-mutation", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    const initialRefresh = store.refreshGitWorkingTreeSnapshot(project.id);
    const write = store.stageGitFile(project.id, "fresh.txt");
    stale.resolve({
      ok: false,
      value: null,
      failure: { code: "command-failed", operation: "status", message: "stale working-tree failure" },
    });
    await Promise.all([initialRefresh, write]);

    expect(readGitWorkingTreeSnapshotResult).toHaveBeenCalledTimes(2);
    expect(project.git?.files).toEqual(freshFiles);
    expect(store.gitRepositoryReadFailures[store.resolveGitRepositoryContext(project.id)!.contextKey]).toBeUndefined();
  });

  it("rejects a pre-reset working-tree response when a project id is recreated", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const mainPath = "C:\\project";
    const stale = createDeferred<ProjectBridgeGitWorkingTreeSnapshot>();
    const fresh = createDeferred<ProjectBridgeGitWorkingTreeSnapshot>();
    const readGitWorkingTreeSnapshot = vi
      .fn<ProjectBridge["readGitWorkingTreeSnapshot"]>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    window.projectBridge = { ...getProjectBridge(), readGitWorkingTreeSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-working-tree-reset", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];

    const staleRefresh = store.refreshGitWorkingTreeSnapshot(project.id);
    await store.deleteProject(project.id);

    const replacement = createProject(project.id, mainPath);
    replacement.git = gitSnapshot(mainPath, "main");
    store.projects = [replacement];
    const freshRefresh = store.refreshGitWorkingTreeSnapshot(replacement.id);
    fresh.resolve(
      workingTreeSnapshot(mainPath, [
        { path: "fresh.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
      ]),
    );
    await freshRefresh;

    stale.resolve(
      workingTreeSnapshot(mainPath, [
        { path: "stale.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: false, unstaged: true },
      ]),
    );
    await staleRefresh;

    expect(replacement.git?.files).toEqual([
      { path: "fresh.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
    ]);
  });

  it("preserves detached HEAD status text while merging a working-tree refresh", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const headHash = "d".repeat(40);
    const readGitWorkingTreeSnapshot = vi.fn<ProjectBridge["readGitWorkingTreeSnapshot"]>(async () =>
      workingTreeSnapshot(mainPath, [
        { path: "changed.txt", additions: 1, deletions: 0, status: "MODIFIED", staged: true, unstaged: false },
      ]),
    );
    window.projectBridge = { ...getProjectBridge(), readGitWorkingTreeSnapshot };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-detached-working-tree", mainPath);
    project.git = {
      ...gitSnapshot(mainPath, "HEAD", headHash),
      isDetachedHead: true,
      statusText: `detached HEAD @ ${headHash} · 工作区干净`,
    };
    store.projects = [project];

    await store.refreshGitWorkingTreeSnapshot(project.id);

    expect(project.git?.statusText).toBe(`detached HEAD @ ${headHash} · 1 个文件变更`);
  });

  it("initializes only the main project path and refreshes Git state", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const initializeGitRepository = vi.fn<ProjectBridge["initializeGitRepository"]>(async () => ({
      ok: true,
      message: "initialized",
    }));
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => gitSnapshot(mainPath, "initialized"));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-05T00:00:00.000Z"),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      initializeGitRepository,
      pathExists,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-init", mainPath);
    project.git = gitSnapshot(mainPath, "stale");
    store.projects = [project];
    store.gitWorkspaces[project.id] = workspaceSnapshot("C:\\stale", "2026-08-04T00:00:00.000Z");

    await expect(store.initializeGitRepository(project.id)).resolves.toEqual({ ok: true, message: "initialized" });

    expect(pathExists).toHaveBeenCalledWith(mainPath);
    expect(initializeGitRepository).toHaveBeenCalledWith(mainPath);
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledWith(mainPath);
    expect(readGitSnapshot).toHaveBeenCalledWith(mainPath, { limit: 80, skip: 0 });
    expect(project.git?.repositoryPath).toBe(mainPath);
    expect(store.gitWorkspaces[project.id]?.repositoryPath).toBe(mainPath);
    expect(store.gitWritesInProgress[project.id]).toBe(0);
  });

  it("serializes concurrent initialization and skips the request after the first refresh", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const firstInitialization = createDeferred<{ ok: true; message: string }>();
    const initializeGitRepository = vi.fn<ProjectBridge["initializeGitRepository"]>(() => firstInitialization.promise);
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => gitSnapshot(mainPath, "initialized"));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-05T00:00:00.000Z"),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      initializeGitRepository,
      pathExists,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-init-queue", mainPath);
    store.projects = [project];

    const first = store.initializeGitRepository(project.id);
    await Promise.resolve();
    await Promise.resolve();
    const second = store.initializeGitRepository(project.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(initializeGitRepository).toHaveBeenCalledOnce();

    firstInitialization.resolve({ ok: true, message: "initialized" });

    await expect(first).resolves.toEqual({ ok: true, message: "initialized" });
    await expect(second).resolves.toBeNull();
    expect(initializeGitRepository).toHaveBeenCalledOnce();
    expect(store.gitWritesInProgress[project.id]).toBe(0);
  });

  it("keeps cached Git state when initialization fails", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const initializeGitRepository = vi.fn<ProjectBridge["initializeGitRepository"]>(async () => ({
      ok: false,
      message: "git init failed",
    }));
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>();
    window.projectBridge = {
      ...getProjectBridge(),
      initializeGitRepository,
      pathExists,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-init-failure", mainPath);
    project.git = gitSnapshot(mainPath, "stale");
    const cachedWorkspace = workspaceSnapshot(mainPath, "2026-08-04T00:00:00.000Z");
    store.projects = [project];
    store.gitWorkspaces[project.id] = cachedWorkspace;

    await expect(store.initializeGitRepository(project.id)).resolves.toEqual({ ok: false, message: "git init failed" });

    expect(project.git?.branch).toBe("stale");
    expect(store.gitWorkspaces[project.id]).toEqual(cachedWorkspace);
    expect(readGitSnapshot).not.toHaveBeenCalled();
    expect(readGitWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(store.gitWritesInProgress[project.id]).toBe(0);
  });

  it("retries a status refresh that began before Git initialization", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const staleStatus = createDeferred<ProjectGitSnapshot>();
    const initializeGitRepository = vi.fn<ProjectBridge["initializeGitRepository"]>(async () => ({
      ok: true,
      message: "initialized",
    }));
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async () => gitSnapshot(mainPath, "initialized"));
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-05T00:00:00.000Z"),
    );
    const readGitStatusSnapshot = vi.fn<ProjectBridge["readGitStatusSnapshot"]>();
    readGitStatusSnapshot
      .mockReturnValueOnce(staleStatus.promise)
      .mockResolvedValueOnce(gitSnapshot(mainPath, "post-init-status"));
    window.projectBridge = {
      ...getProjectBridge(),
      initializeGitRepository,
      pathExists,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
      readGitStatusSnapshot,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-init-status-race", mainPath);
    project.git = gitSnapshot(mainPath, "pre-init");
    store.projects = [project];

    const staleRefresh = store.refreshGitStatusSnapshot(project.id);
    await store.initializeGitRepository(project.id);
    staleStatus.resolve({ ...gitSnapshot("", "main"), statusText: "未检测到 Git 仓库" });
    await staleRefresh;

    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(project.git?.branch).toBe("post-init-status");
    expect(project.git?.statusText).toBe("post-init-status");
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

  it("fully refreshes the authorized repository after failed history actions", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const mainPath = "C:\\project";
    const failure = { ok: false, message: "conflict recovered" };
    const cherryPickGitCommit = vi.fn<ProjectBridge["cherryPickGitCommit"]>(async () => failure);
    const revertGitCommit = vi.fn<ProjectBridge["revertGitCommit"]>(async () => failure);
    const readGitSnapshot = vi.fn<ProjectBridge["readGitSnapshot"]>(async (repositoryPath) =>
      gitSnapshot(repositoryPath, "refreshed"),
    );
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>(async () =>
      workspaceSnapshot(mainPath, "2026-08-05T00:00:00.000Z"),
    );
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
    const project = createProject("project-history-action-failure", mainPath);
    store.projects = [project];

    await expect(store.cherryPickGitCommit(project.id, "a".repeat(40))).resolves.toEqual(failure);
    await expect(store.revertGitCommit(project.id, "b".repeat(40))).resolves.toEqual(failure);

    expect(cherryPickGitCommit).toHaveBeenCalledWith(mainPath, "a".repeat(40));
    expect(revertGitCommit).toHaveBeenCalledWith(mainPath, "b".repeat(40));
    expect(readGitSnapshot).toHaveBeenCalledTimes(2);
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(2);
    expect(store.gitWritesInProgress[project.id]).toBe(0);
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
