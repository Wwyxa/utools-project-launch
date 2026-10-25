import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const manualToken = `ghp_${'m'.repeat(36)}`;
const envToken = `gho_${'e'.repeat(36)}`;
const hostsToken = `gho_${'h'.repeat(36)}`;
const appDataHostsPath = path.join('/appdata', 'GitHub CLI', 'hosts.yml');

type LoadedGithubAuth = {
  parseGithubCliHostsToken: (content: string) => string | null;
  resolveGithubToken: () => Promise<{ token: string; source: 'manual' | 'gh' } | null>;
  markGithubTokenRejected: (token: string) => void;
  invalidateGithubTokenCache: (clearRejectedTokens?: boolean) => void;
  readGithubAuthStatus: () => Promise<{
    configured: boolean;
    source: string | null;
    verified: boolean;
    login: string | null;
    avatarUrl: string | null;
    error: string | null;
    gh: { installed: boolean; version: string | null; credentialFound: boolean };
  }>;
};

const loadGithubAuth = (options: {
  hostsFiles?: Record<string, string>;
  env?: Record<string, string | undefined>;
  manualPersonalAccessToken?: string;
} = {}) => {
  const hostsFiles = options.hostsFiles ?? {};
  const env: Record<string, string | undefined> = { ...(options.env ?? {}) };
  let manualPersonalAccessToken = options.manualPersonalAccessToken ?? '';
  let now = 1_000_000;
  const fetchUser = vi.fn<
    (url: string, init?: { headers: Record<string, string> }) => Promise<{
      ok: boolean;
      status?: number;
      json: () => Promise<{ login?: string; avatar_url?: string }>;
    }>
  >(async () => ({ ok: true, json: async () => ({}) }));
  const execFileMock = vi.fn<
    (
      file: string,
      args: string[],
      options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => void
  >((_file, _args, _options, callback) => {
    callback(new Error('spawn gh ENOENT'), '');
  });
  const readFileSyncCalls: string[] = [];
  const fsMock = {
    statSync: (targetPath: string) => {
      const content = hostsFiles[targetPath];
      if (content === undefined) throw new Error('ENOENT');
      return { isFile: () => true, size: content.length };
    },
    readFileSync: (targetPath: string) => {
      readFileSyncCalls.push(targetPath);
      const content = hostsFiles[targetPath];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
  };
  const context = createContext({
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Date: { now: () => now, parse: Date.parse },
    fetch: fetchUser,
    fs: fsMock,
    os: { homedir: () => '/home/tester' },
    path,
    process: { env, platform: 'win32' },
    execFile: execFileMock,
    readLocalStatePreference: (section: string) =>
      section === 'githubAuth' ? { schemaVersion: 1, personalAccessToken: manualPersonalAccessToken } : {},
    saveLocalStatePreference: (section: string, value: unknown) => {
      manualPersonalAccessToken = (value as { personalAccessToken: string }).personalAccessToken;
      return { ok: true };
    },
  });
  runInContext(readFileSync('public/preload/github-auth.js', 'utf8'), context);
  const load = (name: string) => runInContext(name, context) as LoadedGithubAuth[keyof LoadedGithubAuth];
  return {
    githubAuth: {
      parseGithubCliHostsToken: load('parseGithubCliHostsToken') as LoadedGithubAuth['parseGithubCliHostsToken'],
      resolveGithubToken: load('resolveGithubToken') as LoadedGithubAuth['resolveGithubToken'],
      markGithubTokenRejected: load('markGithubTokenRejected') as LoadedGithubAuth['markGithubTokenRejected'],
      invalidateGithubTokenCache: load(
        'invalidateGithubTokenCache',
      ) as LoadedGithubAuth['invalidateGithubTokenCache'],
      readGithubAuthStatus: load('readGithubAuthStatus') as LoadedGithubAuth['readGithubAuthStatus'],
    },
    fetchUser,
    execFileMock,
    readFileSyncCalls,
    setManualToken: (token: string) => {
      manualPersonalAccessToken = token;
    },
    setEnv: (key: string, value: string | undefined) => {
      env[key] = value;
    },
  };
};

describe('gh hosts.yml token parsing', () => {
  it('reads flat and multi-account layouts, taking the shallowest token', () => {
    const { githubAuth } = loadGithubAuth();
    expect(
      githubAuth.parseGithubCliHostsToken(`github.com:\n    git_protocol: https\n    oauth_token: "${hostsToken}"\n    user: tester\n`),
    ).toBe(hostsToken);
    const nested = `github.com:\n    users:\n        alice:\n            oauth_token: gho_${'a'.repeat(36)}\n        bob:\n            oauth_token: gho_${'b'.repeat(36)}\n`;
    expect(githubAuth.parseGithubCliHostsToken(nested)).toBe(`gho_${'a'.repeat(36)}`);
    expect(githubAuth.parseGithubCliHostsToken(`${nested}    oauth_token: ${hostsToken}\n`)).toBe(hostsToken);
  });

  it('ignores other hosts, malformed values, and expired tokens', () => {
    const { githubAuth } = loadGithubAuth();
    expect(githubAuth.parseGithubCliHostsToken(`ghe.example.com:\n    oauth_token: ${hostsToken}\n`)).toBeNull();
    expect(githubAuth.parseGithubCliHostsToken('github.com:\n    oauth_token: not-a-token\n')).toBeNull();
    expect(githubAuth.parseGithubCliHostsToken('github.com:\n    user: tester\n')).toBeNull();
    expect(
      githubAuth.parseGithubCliHostsToken(
        `github.com:\n    oauth_token: ${hostsToken}\n    oauth_expiry: "1970-01-01T00:00:00Z"\n`,
      ),
    ).toBeNull();
    expect(
      githubAuth.parseGithubCliHostsToken(
        `github.com:\n    oauth_token: ${hostsToken}\n    oauth_expiry: "2999-01-01T00:00:00Z"\n`,
      ),
    ).toBe(hostsToken);
  });
});

describe('resolveGithubToken layering', () => {
  it('prefers the manual PAT, then GH_TOKEN, then the gh hosts.yml file', async () => {
    const { githubAuth, setEnv, setManualToken, readFileSyncCalls, execFileMock } = loadGithubAuth({
      hostsFiles: { [appDataHostsPath]: `github.com:\n    oauth_token: ${hostsToken}\n` },
      env: { GH_TOKEN: envToken, APPDATA: '/appdata' },
      manualPersonalAccessToken: manualToken,
    });
    await expect(githubAuth.resolveGithubToken()).resolves.toEqual({ token: manualToken, source: 'manual' });
    setManualToken('');
    githubAuth.invalidateGithubTokenCache();
    await expect(githubAuth.resolveGithubToken()).resolves.toEqual({ token: envToken, source: 'gh' });
    setEnv('GH_TOKEN', undefined);
    githubAuth.invalidateGithubTokenCache();
    await expect(githubAuth.resolveGithubToken()).resolves.toEqual({ token: hostsToken, source: 'gh' });
    expect(readFileSyncCalls).toEqual([appDataHostsPath]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('falls back to gh auth token when hosts.yml carries no credential', async () => {
    const { githubAuth, execFileMock } = loadGithubAuth({ env: { APPDATA: '/appdata' } });
    execFileMock.mockImplementation((_file, args, _options, callback) => {
      if (args[0] === 'auth') callback(null, `${hostsToken}\n`);
      else callback(new Error('gh missing'), '');
    });
    await expect(githubAuth.resolveGithubToken()).resolves.toEqual({ token: hostsToken, source: 'gh' });
  });

  it('skips rejected tokens and falls through to the next source', async () => {
    const { githubAuth } = loadGithubAuth({
      hostsFiles: { [appDataHostsPath]: `github.com:\n    oauth_token: ${hostsToken}\n` },
      env: { GH_TOKEN: envToken, APPDATA: '/appdata' },
      manualPersonalAccessToken: manualToken,
    });
    githubAuth.markGithubTokenRejected(manualToken);
    await expect(githubAuth.resolveGithubToken()).resolves.toEqual({ token: envToken, source: 'gh' });
  });
});

describe('GitHub auth status', () => {
  it('reports gh installation without contacting GitHub when unconfigured', async () => {
    const { githubAuth, fetchUser, execFileMock } = loadGithubAuth();
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(null, 'gh version 2.103.2 (2026-10-23)\nhttps://github.com/cli/cli/releases\n');
    });
    const status = await githubAuth.readGithubAuthStatus();
    expect(status.configured).toBe(false);
    expect(status.gh).toEqual({ installed: true, version: '2.103.2', credentialFound: false });
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it('verifies the active token and reports gh credentials independently', async () => {
    const { githubAuth, fetchUser } = loadGithubAuth({
      hostsFiles: { [appDataHostsPath]: `github.com:\n    oauth_token: ${hostsToken}\n` },
      env: { APPDATA: '/appdata' },
      manualPersonalAccessToken: manualToken,
    });
    fetchUser.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' }),
    });
    const status = await githubAuth.readGithubAuthStatus();
    expect(status).toMatchObject({ configured: true, source: 'manual', verified: true, login: 'octocat' });
    expect(status.gh.credentialFound).toBe(true);
    const headers = fetchUser.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${manualToken}`);
  });

  it('marks tokens rejected on 401 and surfaces the failure', async () => {
    const { githubAuth, fetchUser } = loadGithubAuth({ manualPersonalAccessToken: manualToken });
    fetchUser.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const status = await githubAuth.readGithubAuthStatus();
    expect(status.configured).toBe(true);
    expect(status.verified).toBe(false);
    expect(status.error).toContain('401');
    await expect(githubAuth.resolveGithubToken()).resolves.toBeNull();
  });
});
