import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const firstHash = 'a'.repeat(40);
const secondHash = 'b'.repeat(40);
const avatarUrl = 'https://avatars.githubusercontent.com/u/123?s=80';

type AvatarFetchResponse = {
  ok: boolean;
  status?: number;
  headers?: Headers;
  json: () => Promise<{ author: { avatar_url: string } }>;
};

const loadAvatarReader = () => {
  const fetchAvatar = vi.fn<(url: string, init?: { headers: Record<string, string> }) => Promise<AvatarFetchResponse>>(
    async () => ({ ok: true, json: async () => ({ author: { avatar_url: avatarUrl } }) }),
  );
  let now = 1000000;
  const readEmail = vi.fn(async () => 'author@example.invalid\n');
  const readRemotes = vi.fn(async () => [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git' }]);
  const resolveToken = vi.fn<() => { token: string; source: 'manual' | 'gh' } | null>(() => null);
  const markRejected = vi.fn();
  const results = new Map<string, Promise<string | null>>();
  const context = createContext({
    URL, AbortController, setTimeout, clearTimeout,
    Date: { now: () => now },
    fetch: fetchAvatar,
    gitCommitAvatarResults: results,
    gitCommitAvatarResultLimit: 160,
    gitCommitAvatarRequestTimeoutMs: 3500,
    resolveGithubToken: resolveToken,
    markGithubTokenRejected: markRejected,
  });
  runInContext(readFileSync('public/preload/git.js', 'utf8'), context);
  Object.assign(context, {
    findGitRootAsync: async (projectPath: string) => projectPath,
    readGitRemotesAsync: readRemotes,
    readGitUpstreamAsync: async () => null,
    runGitAsync: readEmail,
  });
  const readAvatar = runInContext('readGitCommitAuthorAvatar', context) as (
    projectPath: string, hash: string,
  ) => Promise<string | null>;
  return {
    readAvatar, fetchAvatar, readEmail, readRemotes, results,
    resolveToken, markRejected,
    advanceTime: (milliseconds: number) => { now += milliseconds; },
  };
};

describe('Git commit author avatars', () => {
  it('backs off on exhausted anonymous quota but keeps direct avatars available', async () => {
    const { readAvatar, fetchAvatar, readEmail, advanceTime } = loadAvatarReader();
    fetchAvatar.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1120' }),
      json: async () => ({ author: { avatar_url: '' } }),
    });
    await expect(readAvatar('/repo', firstHash)).resolves.toBeNull();
    await expect(readAvatar('/repo', secondHash)).resolves.toBeNull();
    expect(fetchAvatar).toHaveBeenCalledOnce();
    readEmail.mockResolvedValue('123+author@users.noreply.github.com');
    await expect(readAvatar('/repo', secondHash)).resolves.toBe(avatarUrl);
    readEmail.mockResolvedValue('author@example.invalid');
    advanceTime(120001);
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
    expect(fetchAvatar).toHaveBeenCalledTimes(2);
  });
  it('resolves GitHub noreply IDs without a network request', async () => {
    const { readAvatar, readEmail, fetchAvatar } = loadAvatarReader();
    readEmail.mockResolvedValue('123+author@users.noreply.github.com\n');
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
    expect(fetchAvatar).not.toHaveBeenCalled();
  });

  it('shares pending and successful requests across commits by the same author', async () => {
    const { readAvatar, fetchAvatar } = loadAvatarReader();
    await expect(Promise.all([readAvatar('/repo', firstHash), readAvatar('/repo', secondHash)]))
      .resolves.toEqual([avatarUrl, avatarUrl]);
    await expect(readAvatar('/repo', secondHash)).resolves.toBe(avatarUrl);
    expect(fetchAvatar).toHaveBeenCalledOnce();
  });

  it('resolves legacy GitHub noreply logins without a commit API request', async () => {
    const { readAvatar, readEmail, fetchAvatar } = loadAvatarReader();
    readEmail.mockResolvedValue('contributor-name@users.noreply.github.com\n');
    await expect(readAvatar('/repo', firstHash)).resolves.toBe('https://github.com/contributor-name.png?size=80');
    expect(fetchAvatar).not.toHaveBeenCalled();
  });

  it('retries HTTP failures and network errors instead of caching null', async () => {
    const { readAvatar, fetchAvatar, results } = loadAvatarReader();
    fetchAvatar.mockResolvedValueOnce({ ok: false, json: async () => ({ author: { avatar_url: '' } }) });
    await expect(readAvatar('/repo', firstHash)).resolves.toBeNull();
    expect(results.size).toBe(0);
    fetchAvatar.mockRejectedValueOnce(new Error('offline'));
    await expect(readAvatar('/repo', firstHash)).resolves.toBeNull();
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
    expect(fetchAvatar).toHaveBeenCalledTimes(3);
  });

  it('isolates authors and repositories and does not share missing emails', async () => {
    const { readAvatar, fetchAvatar, readEmail, readRemotes } = loadAvatarReader();
    await readAvatar('/repo', firstHash);
    readEmail.mockResolvedValue('other@example.invalid');
    await readAvatar('/repo', secondHash);
    readRemotes.mockResolvedValue([{ name: 'origin', fetchUrl: 'git@github.com:owner/other.git' }]);
    await readAvatar('/other', firstHash);
    readEmail.mockResolvedValue('');
    await readAvatar('/other', firstHash);
    await readAvatar('/other', secondHash);
    expect(fetchAvatar).toHaveBeenCalledTimes(5);
  });

  it('rejects invalid hashes and non-GitHub remotes before requesting avatars', async () => {
    const { readAvatar, fetchAvatar, readRemotes, readEmail } = loadAvatarReader();
    await expect(readAvatar('/repo', '--invalid')).resolves.toBeNull();
    readRemotes.mockResolvedValue([{ name: 'origin', fetchUrl: 'https://example.invalid/owner/repo.git' }]);
    await expect(readAvatar('/repo', firstHash)).resolves.toBeNull();
    expect(fetchAvatar).not.toHaveBeenCalled();
    expect(readEmail).not.toHaveBeenCalled();
  });

  it('does not cache malformed or insecure avatar URLs', async () => {
    const { readAvatar, fetchAvatar, results } = loadAvatarReader();
    for (const invalidUrl of ['', 'http://example.invalid/avatar', 'javascript:alert(1)']) {
      fetchAvatar.mockResolvedValueOnce({ ok: true, json: async () => ({ author: { avatar_url: invalidUrl } }) });
      await expect(readAvatar('/repo', firstHash)).resolves.toBeNull();
      expect(results.size).toBe(0);
    }
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
  });

  it('attaches the resolved GitHub token to commit avatar requests', async () => {
    const { readAvatar, fetchAvatar, resolveToken } = loadAvatarReader();
    const token = `ghp_${'a'.repeat(36)}`;
    resolveToken.mockReturnValue({ token, source: 'manual' });
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
    expect(fetchAvatar).toHaveBeenCalledOnce();
    const headers = fetchAvatar.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('falls back to anonymous requests when the token is rejected with 401', async () => {
    const { readAvatar, fetchAvatar, resolveToken, markRejected } = loadAvatarReader();
    const token = `ghp_${'b'.repeat(36)}`;
    resolveToken
      .mockReturnValueOnce({ token, source: 'gh' })
      .mockReturnValueOnce(null);
    fetchAvatar
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ author: { avatar_url: '' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ author: { avatar_url: avatarUrl } }) });
    await expect(readAvatar('/repo', firstHash)).resolves.toBe(avatarUrl);
    expect(markRejected).toHaveBeenCalledExactlyOnceWith(token);
    expect(fetchAvatar).toHaveBeenCalledTimes(2);
    const rejectedHeaders = fetchAvatar.mock.calls[0][1]?.headers as Record<string, string>;
    const fallbackHeaders = fetchAvatar.mock.calls[1][1]?.headers as Record<string, string>;
    expect(rejectedHeaders.Authorization).toBe(`Bearer ${token}`);
    expect(fallbackHeaders.Authorization).toBeUndefined();
  });
});