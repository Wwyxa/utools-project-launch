import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectGitFileChange } from '../src/types';
import {
  clearGitCommitTooltipSessionsForProject,
  GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES,
  loadGitCommitTooltipSessionDetails,
  markGitCommitTooltipSessionAvatarUnavailable,
  prefetchGitCommitTooltipAvatar,
  pruneGitCommitTooltipSession,
  type GitCommitTooltipSessionLoaders,
} from '../src/lib/gitCommitTooltipSession';

const projectIds = ['tooltip-preloaded', 'tooltip-warm', 'tooltip-reset', 'tooltip-failure', 'tooltip-capacity'];

const files: ProjectGitFileChange[] = [
  { path: 'src/example.ts', additions: 2, deletions: 1, status: 'MODIFIED', staged: false, unstaged: true },
];

const contextKey = (projectId: string) => `${projectId}::main`;

afterEach(() => {
  projectIds.forEach(clearGitCommitTooltipSessionsForProject);
});

describe('Git commit tooltip renderer session', () => {
  it('bounds prefetched hashes and prunes entries when rows disappear', async () => {
    const context = contextKey('tooltip-capacity');
    const loadAvatar = vi.fn(async () => 'https://avatars.example.invalid/cached.png');
    for (let index = 0; index <= GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES; index += 1) {
      await prefetchGitCommitTooltipAvatar(context, `hash-${index}`, loadAvatar);
    }
    await prefetchGitCommitTooltipAvatar(context, 'hash-0', loadAvatar);
    expect(loadAvatar).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 2);
    pruneGitCommitTooltipSession(context, new Set(['hash-0']));
    await prefetchGitCommitTooltipAvatar(context, 'hash-0', loadAvatar);
    await prefetchGitCommitTooltipAvatar(context, 'hash-1', loadAvatar);
    expect(loadAvatar).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 3);
  });

  it('retries failed prefetches and does not resurrect cleared project caches', async () => {
    const context = contextKey('tooltip-failure');
    const hash = 'a'.repeat(40);
    const loadAvatar = vi.fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('https://avatars.example.invalid/recovered.png');
    await expect(prefetchGitCommitTooltipAvatar(context, hash, loadAvatar)).resolves.toEqual({ avatarUrl: null });
    await expect(prefetchGitCommitTooltipAvatar(context, hash, loadAvatar))
      .resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/recovered.png' });
    const pending = prefetchGitCommitTooltipAvatar(context, 'b'.repeat(40), loadAvatar);
    clearGitCommitTooltipSessionsForProject('tooltip-failure');
    await pending;
    await prefetchGitCommitTooltipAvatar(context, 'b'.repeat(40), loadAvatar);
    expect(loadAvatar).toHaveBeenCalledTimes(4);
  });
  it('reuses prefetched avatars without prefetching file details', async () => {
    const context = contextKey('tooltip-preloaded');
    const hash = 'a'.repeat(40);
    const loadAvatar = vi.fn(async () => 'https://avatars.example.invalid/preloaded.png');
    const pending = prefetchGitCommitTooltipAvatar(context, hash, loadAvatar);
    expect(prefetchGitCommitTooltipAvatar(context, hash, loadAvatar)).toBe(pending);
    await pending;
    const loadFiles = vi.fn(async () => files);
    const details = loadGitCommitTooltipSessionDetails(context, hash, { loadAvatar, loadFiles });
    expect(details.avatar).toBe(pending);
    expect(loadAvatar).toHaveBeenCalledOnce();
    await details.files;
    expect(loadFiles).toHaveBeenCalledOnce();
    clearGitCommitTooltipSessionsForProject('tooltip-preloaded');
    await prefetchGitCommitTooltipAvatar(context, hash, loadAvatar);
    expect(loadAvatar).toHaveBeenCalledTimes(2);
  });
  it('uses valid preloaded short stats without a file-detail read', async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => 'https://avatars.example.invalid/preloaded.png');
    const details = loadGitCommitTooltipSessionDetails(contextKey('tooltip-preloaded'), 'p'.repeat(40), {
      preloadedShortStats: { files: 1, additions: 2, deletions: 1 },
      loadFiles,
      loadAvatar,
    });

    await expect(details.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(details.avatar).resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/preloaded.png' });
    expect(loadFiles).not.toHaveBeenCalled();
    expect(loadAvatar).toHaveBeenCalledOnce();
  });

  it("clears only the replaced project's sessions", async () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => 'https://avatars.example.invalid/a.png');
    const hash = 'e'.repeat(40);
    const replacedContext = contextKey('tooltip-reset');
    const retainedContext = contextKey('tooltip-warm');

    loadGitCommitTooltipSessionDetails(replacedContext, hash, { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(retainedContext, hash, { loadFiles, loadAvatar });
    clearGitCommitTooltipSessionsForProject('tooltip-reset');
    loadGitCommitTooltipSessionDetails(replacedContext, hash, { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(retainedContext, hash, { loadFiles, loadAvatar });

    expect(loadFiles).toHaveBeenCalledTimes(3);
    expect(loadAvatar).toHaveBeenCalledTimes(3);
  });

  it('retains file outcomes but retries failed avatars on the next hover', async () => {
    const loadFiles = vi.fn(async () => Promise.reject(new Error('files unavailable')));
    const loadAvatar = vi.fn(async () => Promise.reject(new Error('avatar unavailable')));
    const context = contextKey('tooltip-failure');
    const hash = 'f'.repeat(40);

    const initial = loadGitCommitTooltipSessionDetails(context, hash, { loadFiles, loadAvatar });
    await expect(initial.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(initial.avatar).resolves.toEqual({ avatarUrl: null });
    const reused = loadGitCommitTooltipSessionDetails(context, hash, {
      loadFiles: async () => files,
      loadAvatar: async () => 'https://avatars.example.invalid/f.png',
    });

    await expect(reused.files).resolves.toEqual({ files: null, unavailable: true });
    await expect(reused.avatar).resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/f.png' });
    expect(loadFiles).toHaveBeenCalledOnce();
    expect(loadAvatar).toHaveBeenCalledOnce();

    const imageContext = `${context}:image`;
    const imageDetails = loadGitCommitTooltipSessionDetails(imageContext, hash, {
      loadFiles: async () => files,
      loadAvatar: async () => 'https://avatars.example.invalid/image.png',
    });
    await expect(imageDetails.avatar).resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/image.png' });
    markGitCommitTooltipSessionAvatarUnavailable(imageContext, hash);
    await expect(loadGitCommitTooltipSessionDetails(imageContext, hash, {}).avatar).resolves.toEqual({
      avatarUrl: null,
    });
    const retryAvatar = vi.fn(async () => 'https://avatars.example.invalid/image.png');
    await expect(loadGitCommitTooltipSessionDetails(imageContext, hash, { loadAvatar: retryAvatar }).avatar)
      .resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/image.png' });
    expect(retryAvatar).toHaveBeenCalledOnce();
  });

  it('shares a pending avatar retry and retains the successful result', async () => {
    const context = contextKey('tooltip-failure');
    const hash = 'a'.repeat(40);
    await loadGitCommitTooltipSessionDetails(context, hash, { loadAvatar: async () => null }).avatar;
    let resolveAvatar!: (value: string) => void;
    const loadAvatar = vi.fn(() => new Promise<string>((resolve) => { resolveAvatar = resolve; }));
    const first = loadGitCommitTooltipSessionDetails(context, hash, { loadAvatar }).avatar;
    const second = loadGitCommitTooltipSessionDetails(context, hash, { loadAvatar }).avatar;
    expect(second).toBe(first);
    resolveAvatar('https://avatars.example.invalid/retry.png');
    await expect(first).resolves.toEqual({ avatarUrl: 'https://avatars.example.invalid/retry.png' });
    expect(loadGitCommitTooltipSessionDetails(context, hash, { loadAvatar }).avatar).toBe(first);
    expect(loadAvatar).toHaveBeenCalledOnce();
  });

  it('bounds and prunes retained hashes', () => {
    const loadFiles = vi.fn(async () => files);
    const loadAvatar = vi.fn(async () => null);
    const context = contextKey('tooltip-capacity');

    for (let index = 0; index <= GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES; index += 1) {
      loadGitCommitTooltipSessionDetails(context, `hash-${index}`, { loadFiles, loadAvatar });
    }
    loadGitCommitTooltipSessionDetails(context, 'hash-0', { loadFiles, loadAvatar });
    pruneGitCommitTooltipSession(context, new Set(['hash-0']));
    loadGitCommitTooltipSessionDetails(context, 'hash-0', { loadFiles, loadAvatar });
    loadGitCommitTooltipSessionDetails(context, `hash-${GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES}`, {
      loadFiles,
      loadAvatar,
    });

    expect(loadFiles).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 3);
    expect(loadAvatar).toHaveBeenCalledTimes(GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES + 3);
  });
});
