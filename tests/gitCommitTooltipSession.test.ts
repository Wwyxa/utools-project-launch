import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectGitFileChange } from "../src/types";
import {
  clearGitCommitTooltipSessionsForProject,
  GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES,
  loadGitCommitTooltipSessionDetails,
  markGitCommitTooltipSessionAvatarUnavailable,
  pruneGitCommitTooltipSession,
  type GitCommitTooltipSessionLoaders,
} from "../src/lib/gitCommitTooltipSession";

const projectIds = [
  "tooltip-preloaded",
  "tooltip-warm",
  "tooltip-reset",
  "tooltip-failure",
  "tooltip-capacity",
];

const files: ProjectGitFileChange[] = [
  { path: "src/example.ts", additions: 2, deletions: 1, status: "MODIFIED", staged: false, unstaged: true },
];

const contextKey = (projectId: string) => `${projectId}::main`;

afterEach(() => {
  projectIds.forEach(clearGitCommitTooltipSessionsForProject);
});

describe("Git commit tooltip renderer session", () => {
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
