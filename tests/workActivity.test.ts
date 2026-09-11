import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus } from "../src/types";
import type { Project, ProjectBridge, ProjectGitActivityDayReport, ProjectGitActivityReport } from "../src/types";

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
    expect(store.workActivityLoadState).toBe("stale");
    expect(store.workActivityReport?.lastRefreshedAt).toBe("2026-09-09T00:00:00.000Z");

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
    expect(readGitActivity).toHaveBeenCalledWith([alpha.path, nonGit.path], expect.objectContaining({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      refScope: "all",
      timeZone: "local",
    }));
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

  it("keeps selection in the current Store session and uses an explicit project opening as temporary focus", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const saveUiPreferences = vi.fn<ProjectBridge["saveUiPreferences"]>();
    window.projectBridge = {
      ...getProjectBridge(),
      saveUiPreferences,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const alpha = createProject("alpha", "C:\\alpha");
    const beta = createProject("beta", "C:\\beta");
    store.projects = [alpha, beta];

    store.openWorkActivity();
    store.setWorkActivityProjectIds([alpha.id]);
    store.setWorkActivityPreferences({ selectedAuthorId: "email:alex@example.test" });
    store.returnFromWorkActivity();

    store.openWorkActivity(beta.id);

    expect(store.workActivitySelectedProjectIds).toEqual([alpha.id]);
    expect(store.workActivityFocusProjectId).toBe(beta.id);
    expect(store.workActivityPreferences.selectedAuthorId).toBe("email:alex@example.test");
    expect(saveUiPreferences).not.toHaveBeenCalled();
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

  it("keeps criteria changes in the Store session and invalidates the report cache", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>(async (_paths, options) => ({
      ...activityReport("C:\\alpha", ["C:\\alpha"], "ready"),
      criteria: {
        refScope: options.refScope || "all",
        timeZone: options.timeZone || "local",
        hideMerges: options.hideMerges === true,
        excludeBots: options.excludeBots === true,
        botPatterns: options.botPatterns || [],
        identities: options.identities || [],
      },
    }));
    const saveUiPreferences = vi.fn<ProjectBridge["saveUiPreferences"]>();
    window.projectBridge = { ...getProjectBridge(), readGitActivity, saveUiPreferences };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("alpha", "C:\\alpha")];
    store.openWorkActivity();
    const range = { startDate: "2026-01-01", endDate: "2026-12-31" };

    await store.loadGitActivity(range);
    await store.loadGitActivity(range);
    expect(readGitActivity).toHaveBeenCalledTimes(1);

    store.setWorkActivityPreferences({ refScope: "current", hideMerges: true });
    expect(saveUiPreferences).not.toHaveBeenCalled();
    expect(store.workActivityReport).toBeNull();
    await store.loadGitActivity(range);
    expect(readGitActivity).toHaveBeenCalledTimes(2);
    expect(readGitActivity).toHaveBeenLastCalledWith(
      ["C:\\alpha"],
      expect.objectContaining({ refScope: "current", hideMerges: true }),
    );

    await store.loadGitActivity({ ...range, timeZone: "UTC" });
    await store.loadGitActivity(range);
    expect(readGitActivity).toHaveBeenCalledTimes(4);
    expect(store.workActivityPreferences.timeZone).toBe("local");
  });

  it("drops an older day-detail response when a newer request wins", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const first = createDeferred<ProjectGitActivityDayReport>();
    const second = createDeferred<ProjectGitActivityDayReport>();
    const readGitActivityDay = vi.fn<ProjectBridge["readGitActivityDay"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    window.projectBridge = { ...getProjectBridge(), readGitActivityDay };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("alpha", "C:\\alpha")];
    store.openWorkActivity();
    const report = (date: string): ProjectGitActivityDayReport => ({
      date,
      totalCommits: 0,
      hasMore: false,
      commits: [],
      failedRepositories: [],
      lastRefreshedAt: "2026-09-10T00:00:00.000Z",
    });

    const olderRequest = store.readGitActivityDay({ date: "2026-02-03" });
    const newerRequest = store.readGitActivityDay({ date: "2026-02-04" });
    second.resolve(report("2026-02-04"));
    await expect(newerRequest).resolves.toMatchObject({ date: "2026-02-04" });
    first.resolve(report("2026-02-03"));
    await expect(olderRequest).resolves.toBeNull();
  });

  it("saves, applies, renames, and deletes named project groups", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const saveUiPreferences = vi.fn<ProjectBridge["saveUiPreferences"]>();
    window.projectBridge = { ...getProjectBridge(), saveUiPreferences };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [createProject("alpha", "C:\\alpha"), createProject("beta", "C:\\beta")];
    store.openWorkActivity();
    store.setWorkActivityProjectIds(["alpha"]);

    expect(store.saveWorkActivityProjectGroup(" Main work ")).toBe(true);
    const group = store.workActivityPreferences.projectGroups[0];
    expect(group).toMatchObject({ name: "Main work", projectIds: ["alpha"] });

    store.setWorkActivityProjectIds(["beta"]);
    expect(store.applyWorkActivityProjectGroup(group.id)).toBe(true);
    expect(store.workActivitySelectedProjectIds).toEqual(["alpha"]);
    expect(store.renameWorkActivityProjectGroup(group.id, "Primary")).toBe(true);
    expect(store.workActivityPreferences.projectGroups[0].name).toBe("Primary");
    expect(store.deleteWorkActivityProjectGroup(group.id)).toBe(true);
    expect(store.workActivityPreferences.projectGroups).toEqual([]);
    expect(saveUiPreferences).not.toHaveBeenCalled();
  });

  it("resets work activity session state when a new Store is created", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const saveUiPreferences = vi.fn<ProjectBridge["saveUiPreferences"]>();
    window.projectBridge = { ...getProjectBridge(), saveUiPreferences };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const firstStore = useStore();
    firstStore.projects = [createProject("alpha", "C:\\alpha")];
    firstStore.openWorkActivity();
    firstStore.setWorkActivityProjectIds([]);
    firstStore.setWorkActivityPreferences({ rangeMode: "days7", selectedAuthorId: "" });
    firstStore.saveWorkActivityProjectGroup("Session group");

    setActivePinia(createPinia());
    const restartedStore = useStore();

    expect(restartedStore.workActivityPreferences).toMatchObject({
      rangeMode: "rolling",
      selectedAuthorId: "current",
      projectGroups: [],
    });
    expect(restartedStore.workActivitySelectedProjectIds).toEqual([]);
    expect(saveUiPreferences).not.toHaveBeenCalled();
  });

  it("retries one failed repository without discarding successful repositories", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const betaReport = activityReport("C:\\beta", ["C:\\beta"], "ready");
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>(async () => betaReport);
    window.projectBridge = { ...getProjectBridge(), readGitActivity };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const alpha = activityReport("C:\\alpha", ["C:\\alpha"], "ready").repositories[0];
    store.workActivityReport = {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      repositories: [
        alpha,
        {
          repositoryPath: "C:\\beta",
          projectPaths: ["C:\\beta"],
          state: "failed",
          totalCommits: 0,
          activeDays: 0,
          daily: [],
          authors: [],
          message: "offline",
        },
      ],
      lastRefreshedAt: "2026-09-09T00:00:00.000Z",
    };

    await expect(
      store.retryWorkActivityRepository("C:\\beta", { startDate: "2026-01-01", endDate: "2026-12-31" }),
    ).resolves.toBe(true);

    expect(readGitActivity).toHaveBeenCalledWith(["C:\\beta"], expect.objectContaining({ force: true }));
    expect(store.workActivityReport.repositories).toEqual([alpha, betaReport.repositories[0]]);
    expect(store.workActivityLoadState).toBe("ready");
    expect(store.workActivityRetryingRepositoryPaths).toEqual([]);
  });

  it("targets a failed repository by project path when the repository root is unavailable", async () => {
    vi.stubGlobal("window", {
      navigator: { platform: "Win32", userAgent: "vitest" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      projectBridge: undefined,
    });
    const betaReport = activityReport("C:\\beta", ["C:\\beta"], "ready");
    const readGitActivity = vi.fn<ProjectBridge["readGitActivity"]>(async () => betaReport);
    window.projectBridge = { ...getProjectBridge(), readGitActivity };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.workActivityReport = {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      repositories: [
        {
          repositoryPath: "",
          projectPaths: ["C:\\alpha"],
          state: "failed",
          totalCommits: 0,
          activeDays: 0,
          daily: [],
          authors: [],
        },
        {
          repositoryPath: "",
          projectPaths: ["C:\\beta"],
          state: "failed",
          totalCommits: 0,
          activeDays: 0,
          daily: [],
          authors: [],
        },
      ],
      lastRefreshedAt: "2026-09-09T00:00:00.000Z",
    };

    await expect(
      store.retryWorkActivityRepository("C:\\beta", { startDate: "2026-01-01", endDate: "2026-12-31" }),
    ).resolves.toBe(true);

    expect(readGitActivity).toHaveBeenCalledWith(["C:\\beta"], expect.objectContaining({ force: true }));
    expect(store.workActivityReport.repositories[0].state).toBe("failed");
    expect(store.workActivityReport.repositories[1]).toEqual(betaReport.repositories[0]);
  });
});
