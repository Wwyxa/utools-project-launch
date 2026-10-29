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
