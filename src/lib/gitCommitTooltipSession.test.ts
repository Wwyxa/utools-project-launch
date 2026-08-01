import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectGitFileChange } from "../types";
import {
  clearGitCommitTooltipSessionsForProject,
  GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES,
  loadGitCommitTooltipSessionDetails,
  markGitCommitTooltipSessionAvatarUnavailable,
  pruneGitCommitTooltipSession,
  type GitCommitTooltipSessionLoaders,
} from "./gitCommitTooltipSession";

const projectIds = [
  "tooltip-delay",
  "tooltip-preloaded",
  "tooltip-warm",
  "tooltip-remount",
  "tooltip-context",
  "tooltip-reset",
  "tooltip-failure",
  "tooltip-capacity",
];

const files: ProjectGitFileChange[] = [
  { path: "src/example.ts", additions: 2, deletions: 1, status: "MODIFIED", staged: false, unstaged: true },
];

const contextKey = (projectId: string) => `${projectId}::main`;

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

type TooltipProjection = {
  files: ProjectGitFileChange[] | null;
  filesUnavailable: boolean;
  avatarUrl: string | null;
  isLoadingFiles: boolean;
  isLoadingAvatar: boolean;
  requestGeneration: number;
};

const createTooltipRenderer = (initialContextKey: string, loaders: GitCommitTooltipSessionLoaders) => {
  let activeContextKey = initialContextKey;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let requestGeneration = 0;
  const details = new Map<string, TooltipProjection>();

  const loadVisibleTooltip = (hash: string) => {
    if (details.has(hash)) return;

    const contextAtRequest = activeContextKey;
    const projection: TooltipProjection = {
      files: null,
      filesUnavailable: false,
      avatarUrl: null,
      isLoadingFiles: true,
      isLoadingAvatar: true,
      requestGeneration: ++requestGeneration,
    };
    details.set(hash, projection);
    const session = loadGitCommitTooltipSessionDetails(contextAtRequest, hash, loaders);
    void session.files.then((result) => {
      if (activeContextKey !== contextAtRequest || details.get(hash) !== projection) return;
      projection.files = result.files;
      projection.filesUnavailable = result.unavailable;
      projection.isLoadingFiles = false;
    });
    void session.avatar.then((result) => {
      if (activeContextKey !== contextAtRequest || details.get(hash) !== projection) return;
      projection.avatarUrl = result.avatarUrl;
      projection.isLoadingAvatar = false;
    });
  };

  return {
    enter(hash: string) {
      globalThis.clearTimeout(openTimer);
      openTimer = globalThis.setTimeout(() => {
        openTimer = undefined;
        loadVisibleTooltip(hash);
      }, 450);
    },
    leave() {
      globalThis.clearTimeout(openTimer);
      openTimer = undefined;
    },
    showVisibleTooltip: loadVisibleTooltip,
    replaceContext(nextContextKey: string) {
      activeContextKey = nextContextKey;
      details.clear();
    },
    detailsFor: (hash: string) => details.get(hash),
  };
};

afterEach(() => {
  projectIds.forEach(clearGitCommitTooltipSessionsForProject);
  vi.useRealTimers();
});

describe("Git commit tooltip renderer session", () => {
  it("does not start detail reads before the visible-tooltip delay", async () => {
    vi.useFakeTimers();
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => "https://avatars.example.invalid/a.png");
    const renderer = createTooltipRenderer(contextKey("tooltip-delay"), { loadFiles, loadAvatar });

    renderer.enter("a".repeat(40));
    renderer.leave();
    await vi.advanceTimersByTimeAsync(450);

    expect(loadFiles).not.toHaveBeenCalled();
    expect(loadAvatar).not.toHaveBeenCalled();
  });

  it("uses valid preloaded short stats without a file-detail read", async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => "https://avatars.example.invalid/preloaded.png");
    const details = loadGitCommitTooltipSessionDetails(contextKey("tooltip-preloaded"), "p".repeat(40), {
      preloadedShortStats: { files: 1, additions: 2, deletions: 1 },
      loadFiles,
      loadAvatar,
    });

    await expect(details.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(details.avatar).resolves.toEqual({ avatarUrl: "https://avatars.example.invalid/preloaded.png" });
    expect(loadFiles).not.toHaveBeenCalled();
    expect(loadAvatar).toHaveBeenCalledOnce();
  });

  it("reuses settled same-hash and A-B-A reads", async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => "https://avatars.example.invalid/a.png");
    const renderer = createTooltipRenderer(contextKey("tooltip-warm"), { loadFiles, loadAvatar });
    const firstHash = "a".repeat(40);
    const secondHash = "b".repeat(40);

    renderer.showVisibleTooltip(firstHash);
    renderer.showVisibleTooltip(firstHash);
    renderer.showVisibleTooltip(secondHash);
    renderer.showVisibleTooltip(firstHash);
    await Promise.resolve();

    expect(loadFiles).toHaveBeenCalledTimes(2);
    expect(loadAvatar).toHaveBeenCalledTimes(2);
  });

  it("reuses in-flight reads after a component remount", async () => {
    const pendingFiles = deferred<ProjectGitFileChange[]>();
    const pendingAvatar = deferred<string | null>();
    const loadFiles = vi.fn(() => pendingFiles.promise);
    const loadAvatar = vi.fn(() => pendingAvatar.promise);
    const hash = "c".repeat(40);
    const firstMount = createTooltipRenderer(contextKey("tooltip-remount"), { loadFiles, loadAvatar });
    const remount = createTooltipRenderer(contextKey("tooltip-remount"), { loadFiles, loadAvatar });

    firstMount.showVisibleTooltip(hash);
    remount.showVisibleTooltip(hash);

    expect(loadFiles).toHaveBeenCalledOnce();
    expect(loadAvatar).toHaveBeenCalledOnce();
    pendingFiles.resolve(files);
    pendingAvatar.resolve("https://avatars.example.invalid/c.png");
    await Promise.resolve();
    await Promise.resolve();

    expect(remount.detailsFor(hash)?.files).toEqual(files);
    expect(remount.detailsFor(hash)?.avatarUrl).toBe("https://avatars.example.invalid/c.png");
  });

  it("reuses settled reads after a component remount", async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => "https://avatars.example.invalid/settled.png");
    const hash = "s".repeat(40);
    const firstMount = createTooltipRenderer(contextKey("tooltip-remount"), { loadFiles, loadAvatar });

    firstMount.showVisibleTooltip(hash);
    await Promise.resolve();
    await Promise.resolve();
    const remount = createTooltipRenderer(contextKey("tooltip-remount"), { loadFiles, loadAvatar });
    remount.showVisibleTooltip(hash);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadFiles).toHaveBeenCalledOnce();
    expect(loadAvatar).toHaveBeenCalledOnce();
    expect(remount.detailsFor(hash)?.files).toEqual(files);
    expect(remount.detailsFor(hash)?.avatarUrl).toBe("https://avatars.example.invalid/settled.png");
  });

  it("isolates contexts and rejects a late old-context projection", async () => {
    const staleFiles = deferred<ProjectGitFileChange[]>();
    const freshFiles = deferred<ProjectGitFileChange[]>();
    const staleAvatar = deferred<string | null>();
    const freshAvatar = deferred<string | null>();
    const loadFiles = vi.fn().mockReturnValueOnce(staleFiles.promise).mockReturnValueOnce(freshFiles.promise);
    const loadAvatar = vi.fn().mockReturnValueOnce(staleAvatar.promise).mockReturnValueOnce(freshAvatar.promise);
    const hash = "d".repeat(40);
    const renderer = createTooltipRenderer(contextKey("tooltip-context"), { loadFiles, loadAvatar });

    renderer.showVisibleTooltip(hash);
    renderer.replaceContext(`${contextKey("tooltip-context")}:replacement`);
    renderer.showVisibleTooltip(hash);
    staleFiles.resolve([{ ...files[0], path: "stale.ts" }]);
    staleAvatar.resolve("https://avatars.example.invalid/stale.png");
    await Promise.resolve();
    await Promise.resolve();

    expect(renderer.detailsFor(hash)?.isLoadingFiles).toBe(true);
    expect(renderer.detailsFor(hash)?.avatarUrl).toBeNull();
    freshFiles.resolve(files);
    freshAvatar.resolve("https://avatars.example.invalid/fresh.png");
    await Promise.resolve();
    await Promise.resolve();

    expect(loadFiles).toHaveBeenCalledTimes(2);
    expect(loadAvatar).toHaveBeenCalledTimes(2);
    expect(renderer.detailsFor(hash)?.files).toEqual(files);
    expect(renderer.detailsFor(hash)?.avatarUrl).toBe("https://avatars.example.invalid/fresh.png");
  });

  it("clears only the replaced project's sessions", async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => "https://avatars.example.invalid/a.png");
    const hash = "e".repeat(40);
    const replacedContext = contextKey("tooltip-reset");
    const retainedContext = contextKey("tooltip-warm");

    loadGitCommitTooltipSessionDetails(replacedContext, hash, { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(retainedContext, hash, { loadFiles, loadAvatar });
    clearGitCommitTooltipSessionsForProject("tooltip-reset");
    loadGitCommitTooltipSessionDetails(replacedContext, hash, { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(retainedContext, hash, { loadFiles, loadAvatar });

    expect(loadFiles).toHaveBeenCalledTimes(3);
    expect(loadAvatar).toHaveBeenCalledTimes(3);
  });

  it("retains unavailable file and avatar outcomes with initials fallback", async () => {
    const loadFiles = vi.fn(async () => Promise.reject(new Error("files unavailable")));
    const loadAvatar = vi.fn(async () => Promise.reject(new Error("avatar unavailable")));
    const context = contextKey("tooltip-failure");
    const hash = "f".repeat(40);

    const initial = loadGitCommitTooltipSessionDetails(context, hash, { loadFiles, loadAvatar });
    await expect(initial.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(initial.avatar).resolves.toEqual({ avatarUrl: null });
    const reused = loadGitCommitTooltipSessionDetails(context, hash, {
      loadFiles: async () => files,
      loadAvatar: async () => "https://avatars.example.invalid/f.png",
    });

    await expect(reused.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(reused.avatar).resolves.toEqual({ avatarUrl: null });
    expect(loadFiles).toHaveBeenCalledOnce();
    expect(loadAvatar).toHaveBeenCalledOnce();

    const imageContext = `${context}:image`;
    const imageDetails = loadGitCommitTooltipSessionDetails(imageContext, hash, {
      loadFiles: async () => files,
      loadAvatar: async () => "https://avatars.example.invalid/image.png",
    });
    await expect(imageDetails.avatar).resolves.toEqual({ avatarUrl: "https://avatars.example.invalid/image.png" });
    markGitCommitTooltipSessionAvatarUnavailable(imageContext, hash);
    await expect(loadGitCommitTooltipSessionDetails(imageContext, hash, {}).avatar).resolves.toEqual({
      avatarUrl: null,
    });
  });

  it("bounds and prunes retained hashes", () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => null);
    const context = contextKey("tooltip-capacity");

    for (let index = 0; index <= GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES; index += 1) {
      loadGitCommitTooltipSessionDetails(context, `hash-${index}`, { loadFiles, loadAvatar });
    }
    loadGitCommitTooltipSessionDetails(context, "hash-0", { loadFiles, loadAvatar });
    pruneGitCommitTooltipSession(context, new Set(["hash-0"]));
    loadGitCommitTooltipSessionDetails(context, "hash-0", { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(context, `hash-${GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES}`, {
      loadFiles,
      loadAvatar,
    });

    expect(loadFiles).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 3);
    expect(loadAvatar).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 3);
  });
});
