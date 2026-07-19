import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "./projectBridge";
import { gitRepositoryPathsEqual } from "./gitRepositoryTarget";
import { ProjectStatus } from "../types";
import type {
  Project,
  ProjectBridge,
  ProjectGitRepositoryTarget,
  ProjectGitSnapshot,
  ProjectGitSubmoduleSummary,
  ProjectGitWorkspaceSnapshot,
  ProjectGitWorktreeSummary,
} from "../types";

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

const gitSnapshot = (repositoryPath: string, branch: string, hash = "c".repeat(40)): ProjectGitSnapshot => ({
  branch,
  headHash: hash,
  ahead: 0,
  behind: 0,
  files: [],
  commits: [{ hash, message: branch, author: "Tester", date: "2026-07-19T10:00:00.000Z" }],
  branches: [],
  remotes: [],
  upstream: null,
  hasMoreCommits: false,
  repositoryPath,
  lastRefreshedAt: "2026-07-19T10:00:00.000Z",
  statusText: branch,
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

    const snapshot = await getProjectBridge().readGitWorkspaceSnapshot("C:\\preview-only");

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

    const { useStore } = await import("../store/useStore");
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
    const openEditor = vi.fn<ProjectBridge["openEditor"]>(async (payload) => ({
      launched: true,
      command: "editor",
      cwd: payload.projectPath,
      kind: payload.editor.kind,
    }));
    const pathExists = vi.fn<ProjectBridge["pathExists"]>(async () => true);
    const testBridge: ProjectBridge = { ...getProjectBridge(), openEditor, pathExists };
    window.projectBridge = testBridge;

    const { useStore } = await import("../store/useStore");
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
    expect(openEditor).not.toHaveBeenCalled();

    await store.openGitRepositoryInEditor("project-workspace", {
      kind: "worktree",
      path: "C:\\healthy-worktree",
    });
    expect(openEditor).toHaveBeenCalledOnce();
    expect(openEditor.mock.calls[0]?.[0].projectPath).toBe("C:\\healthy-worktree");
  });

  it("resolves closed repository targets from the latest workspace snapshot", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });

    const { useStore } = await import("../store/useStore");
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

    const { useStore } = await import("../store/useStore");
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

    const { useStore } = await import("../store/useStore");
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

    const { useStore } = await import("../store/useStore");
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

    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project-status-race", mainPath);
    project.git = gitSnapshot(mainPath, "main");
    store.projects = [project];
    store.gitWorkspaces[project.id] = currentWorkspace;
    const worktreeTarget = { kind: "worktree", path: worktreePath } as const;
    const submoduleTarget = { kind: "submodule", path: submodulePath } as const;

    const staleStatusRefresh = store.refreshGitStatusSnapshot(project.id, submoduleTarget);
    await store.commitGitStaged(project.id, "advance shared refs", worktreeTarget);
    pendingStatus.resolve(gitSnapshot(submodulePath, "stale-submodule-status"));
    await staleStatusRefresh;

    expect(readGitStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(store.gitSnapshotForRepository(project.id, submoduleTarget)?.branch).toBe("fresh-submodule-status");
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
    const checkoutGitCommit = vi.fn<ProjectBridge["checkoutGitCommit"]>(async () => success);
    const addGitRemote = vi.fn<ProjectBridge["addGitRemote"]>(async () => success);
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
      checkoutGitCommit,
      addGitRemote,
      readGitStatusSnapshot,
      readGitSnapshot,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../store/useStore");
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
    await store.checkoutGitCommit(project.id, "d".repeat(40), {}, { kind: "main" });
    await store.addGitRemote(project.id, "fork", "../fork.git", worktreeTarget);
    await store.checkoutGitCommit(project.id, "e".repeat(40), {}, worktreeTarget);
    await store.addGitRemote(project.id, "mirror", "../mirror.git", submoduleTarget);

    expect(stageGitFile).toHaveBeenCalledWith(worktreePath, "worktree.txt");
    expect(commitGitStaged).toHaveBeenCalledWith(submodulePath, "submodule commit");
    expect(checkoutGitCommit.mock.calls[0]?.[0]).toBe(mainPath);
    expect(checkoutGitCommit.mock.calls[0]?.[2]?.preferredBranch).toBe("main");
    expect(checkoutGitCommit.mock.calls[1]?.[0]).toBe(worktreePath);
    expect(addGitRemote).toHaveBeenCalledWith(worktreePath, "fork", "../fork.git");
    expect(addGitRemote).toHaveBeenCalledWith(submodulePath, "mirror", "../mirror.git");
    expect(readGitWorkspaceSnapshot).toHaveBeenCalledTimes(6);
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
    const checkoutGitCommit = vi.fn<ProjectBridge["checkoutGitCommit"]>();
    const addGitRemote = vi.fn<ProjectBridge["addGitRemote"]>();
    const readGitWorkspaceSnapshot = vi.fn<ProjectBridge["readGitWorkspaceSnapshot"]>();
    window.projectBridge = {
      ...getProjectBridge(),
      stageGitFile,
      commitGitStaged,
      checkoutGitCommit,
      addGitRemote,
      readGitWorkspaceSnapshot,
    };

    const { useStore } = await import("../store/useStore");
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
    await expect(store.checkoutGitCommit("project-stale-write", "e".repeat(40), {}, staleTarget)).resolves.toBeNull();
    await expect(store.addGitRemote("project-stale-write", "fork", "../fork.git", staleTarget)).resolves.toBeNull();

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
    expect(checkoutGitCommit).not.toHaveBeenCalled();
    expect(addGitRemote).not.toHaveBeenCalled();
    expect(readGitWorkspaceSnapshot).not.toHaveBeenCalled();
  });
});
