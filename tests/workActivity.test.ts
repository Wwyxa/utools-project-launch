import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus } from "../src/types";
import type { Project, ProjectBridge, ProjectGitActivityReport } from "../src/types";

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

const activityReport = (repositoryPath: string, projectPaths: string[], state: "ready" | "not-a-repository") =>
  ({
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    repositories: [
      {
        repositoryPath: state === "ready" ? repositoryPath : "",
        projectPaths,
        state,
        totalCommits: state === "ready" ? 2 : 0,
        activeDays: state === "ready" ? 1 : 0,
        daily: state === "ready" ? [{ date: "2026-02-03", commits: 2, authors: { "email:alex@example.test": 2 } }] : [],
        authors: state === "ready" ? [{ id: "email:alex@example.test", name: "Alex", commits: 2 }] : [],
      },
    ],
    lastRefreshedAt: "2026-09-09T00:00:00.000Z",
  }) satisfies ProjectGitActivityReport;

describe("work activity Store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reuses one report on reopen, deduplicates loading, and retains stale content on refresh failure", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const pending = createDeferred<ProjectGitActivityReport>();
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>().mockReturnValueOnce(pending.promise);
    window.projectBridge = { ...getProjectBridge(), readGitActivity };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const alpha = createProject("alpha", "C:\\alpha");
    store.projects = [alpha];
    const options = { startDate: "2026-01-01", endDate: "2026-12-31" };
    store.openWorkActivity();
    const initialLoad = store.loadGitActivity(options);
    store.returnFromWorkActivity();
    store.openWorkActivity();
    await store.loadGitActivity(options);
    expect(readGitActivity).toHaveBeenCalledTimes(1);
    pending.resolve(activityReport(alpha.path, [alpha.path], "ready"));
    await initialLoad;
    const report = store.workActivityReport;
    store.returnFromWorkActivity();
    store.openWorkActivity();
    expect(store.workActivityReport).toBe(report);
    await store.loadGitActivity(options);
    expect(readGitActivity).toHaveBeenCalledTimes(1);

    readGitActivity.mockRejectedValueOnce(new Error("offline"));
    await store.loadGitActivity({ ...options, force: true });
    expect(readGitActivity).toHaveBeenCalledTimes(2);
    expect(store.workActivityReport).toBe(report);
    expect(store.workActivityMessage).toBe("offline");
    expect(store.workActivityLoading).toBe(false);

    readGitActivity.mockResolvedValue(activityReport(alpha.path, [alpha.path], "ready"));
    await store.loadGitActivity(options);
    expect(readGitActivity).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(1000 + 5 * 60 * 1000);
    await store.loadGitActivity(options);
    expect(readGitActivity).toHaveBeenCalledTimes(4);

    const nextRange = createDeferred<ProjectGitActivityReport>();
    readGitActivity.mockReturnValueOnce(nextRange.promise);
    const rangeLoad = store.loadGitActivity({ startDate: "2025-01-01", endDate: "2025-12-31" });
    expect(store.workActivityReport).toBeNull();
    store.setWorkActivityProjectIds([]);
    expect(store.workActivityLoading).toBe(false);
    nextRange.resolve(activityReport(alpha.path, [alpha.path], "ready"));
    await rangeLoad;
    expect(store.workActivityReport).toBeNull();
  });

  it("uses all available projects by default, removes non-Git projects, and restores detail navigation", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>(async (projectPaths) => ({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      repositories: [
        activityReport("C:\\alpha", ["C:\\alpha"], "ready").repositories[0],
        activityReport("", ["C:\\not-git"], "not-a-repository").repositories[0],
      ],
      lastRefreshedAt: "2026-09-09T00:00:00.000Z",
    }));
    window.projectBridge = { ...getProjectBridge(), readGitActivity };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const alpha = createProject("alpha", "C:\\alpha");
    const nonGit = createProject("not-git", "C:\\not-git");
    store.projects = [alpha, nonGit];

    store.setSelectedProject(alpha.id);
    store.openWorkActivity();
    expect(store.activeTab).toBe("activity");
    expect(store.workActivitySelectedProjectIds).toEqual([alpha.id, nonGit.id]);

    await store.loadGitActivity({ startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(readGitActivity).toHaveBeenCalledWith([alpha.path, nonGit.path], {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(store.workActivityUnavailableProjectIds).toEqual([nonGit.id]);
    expect(store.workActivitySelectedProjectIds).toEqual([alpha.id]);

    store.openWorkActivity(nonGit.id);
    expect(store.workActivitySelectedProjectIds).toEqual([alpha.id]);

    store.returnFromWorkActivity();
    expect(store.activeTab).toBe("projects");
    expect(store.selectedProjectId).toBe(alpha.id);

    store.openProjectGit(alpha.id, "abc123");
    expect(store.projectDetailsTabRequest).toMatchObject({
      tab: "git",
      commitHash: "abc123",
    });
    expect(store.selectedProjectId).toBe(alpha.id);
  });

  it("ignores a stale report after the selected project set changes", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const stale = createDeferred<ProjectGitActivityReport>();
    const latest = createDeferred<ProjectGitActivityReport>();
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>();
    readGitActivity.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    window.projectBridge = { ...getProjectBridge(), readGitActivity };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const alpha = createProject("alpha", "C:\\alpha");
    const beta = createProject("beta", "C:\\beta");
    store.projects = [alpha, beta];
    store.openWorkActivity();

    const staleLoad = store.loadGitActivity({ startDate: "2026-01-01", endDate: "2026-12-31" });
    store.setWorkActivityProjectIds([beta.id]);
    const latestLoad = store.loadGitActivity({ startDate: "2026-01-01", endDate: "2026-12-31" });
    latest.resolve(activityReport(beta.path, [beta.path], "ready"));
    await latestLoad;
    stale.resolve(activityReport(alpha.path, [alpha.path], "ready"));
    await staleLoad;

    expect(store.workActivityReport?.repositories[0]?.repositoryPath).toBe(beta.path);
    expect(store.workActivityLoading).toBe(false);
  });

  it("makes a project selectable again after Git initialization succeeds", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const initializeGitRepository = vi.fn<ProjectBridge["initializeGitRepository"]>(async () => ({
      ok: true,
      message: "Git repository initialized.",
    }));
    window.projectBridge = { ...getProjectBridge(), initializeGitRepository };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project = createProject("project", "C:\\project");
    store.projects = [project];
    store.workActivityUnavailableProjectIds = [project.id];

    const result = await store.initializeGitRepository(project.id);

    expect(result?.ok).toBe(true);
    expect(store.workActivityUnavailableProjectIds).toEqual([]);
    expect(store.workActivitySelectableProjects).toEqual([project]);
  });
});
