import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

const jsonResponse = (payload: unknown, status = 200): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => payload,
});

type LoadedGithubPr = {
  updateGithubPullRequest: (input: Record<string, unknown>) => Promise<{
    ok: boolean;
    value: unknown;
    failure?: { code: string; message: string };
  }>;
  readGithubRepositoryMetadataResult: (owner: string, repository: string) => Promise<{
    ok: boolean;
    value: any;
    failure?: { code: string; message: string };
  }>;
  readGithubPullRequestTemplatesResult: (owner: string, repository: string) => Promise<{
    ok: boolean;
    value: any;
    failure?: { code: string; message: string };
  }>;
  readGithubOpenPullRequestResult: (
    owner: string,
    repository: string,
    headOwner: string,
    branch: string,
  ) => Promise<{ ok: boolean; value: any; failure?: { code: string; message: string } }>;
  createGithubPullRequest: (input: Record<string, unknown>) => Promise<{
    ok: boolean;
    value: any;
    failure?: { code: string; message: string };
  }>;
  readGithubPrContextResult: (
    projectPath: string,
    options: { baseRemote: string; baseBranch: string; headBranch: string },
  ) => Promise<{ ok: boolean; value: any; failure?: { code: string; message: string } }>;
};

interface LoadGithubPrOptions {
  fetchImpl?: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<MockResponse>;
  resolveGithubTokenImpl?: () => Promise<{ token: string; source: string } | null>;
  gitCommands?: (args: string[]) => { ok: boolean; stdout: string; stderr?: string } | undefined;
}

const loadGithubPr = (options: LoadGithubPrOptions = {}) => {
  const fetchMock = vi.fn(options.fetchImpl ?? (async () => jsonResponse({})));
  const markGithubTokenRejected = vi.fn();
  const runGitAsyncResult = vi.fn(async (_repositoryPath: string, args: string[]) => {
    const handler = options.gitCommands?.(args);
    if (handler) return handler;
    return { ok: false, stdout: '', stderr: 'unexpected git call' };
  });
  const findGitRootAsyncResult = vi.fn(async () => ({ ok: true, repositoryPath: '/repo' }));

  const context = createContext({
    fetch: fetchMock,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    resolveGithubToken: options.resolveGithubTokenImpl ?? (async () => ({ token: 'ghp_testtoken', source: 'manual' })),
    markGithubTokenRejected,
    findGitRootAsyncResult,
    runGitAsyncResult,
    createGitReadFailure: (operation: string, result: { stderr?: string; status?: number }, fallback: string) => ({
      code: 'command-failed',
      operation,
      message: `${fallback}(${result.stderr || result.status})`,
    }),
    truncateGitDiff: (diff: string, maxLength = 32000) =>
      diff.length <= maxLength
        ? { diff, truncated: false }
        : { diff: `${diff.slice(0, maxLength)}\n[截断]`, truncated: true },
    gitCommitRecordSeparator: '\x1e',
    gitCommitFieldSeparator: '\x1f',
  });
  runInContext(readFileSync('public/preload/github-pr.js', 'utf8'), context);
  const load = (name: string) => runInContext(name, context);

  return {
    githubPr: {
      updateGithubPullRequest: load('updateGithubPullRequest'),
      readGithubRepositoryMetadataResult: load('readGithubRepositoryMetadataResult'),
      readGithubPullRequestTemplatesResult: load('readGithubPullRequestTemplatesResult'),
      readGithubOpenPullRequestResult: load('readGithubOpenPullRequestResult'),
      createGithubPullRequest: load('createGithubPullRequest'),
      readGithubPrContextResult: load('readGithubPrContextResult'),
    } as LoadedGithubPr,
    fetchMock,
    markGithubTokenRejected,
    runGitAsyncResult,
  };
};

describe('createGithubPullRequest', () => {
  it('sends the same-repo head as a plain branch name', async () => {
    const { githubPr, fetchMock } = loadGithubPr({
      fetchImpl: async () =>
        jsonResponse({
          data: {
            createPullRequest: {
              pullRequest: {
                number: 9,
                title: 'T',
                url: 'https://github.com/wyxa/app/pull/9',
                isDraft: false,
                state: 'open',
                baseRefName: 'main',
                headRefName: 'feat/x',
              },
            },
          },
        }),
    });
    const result = await githubPr.createGithubPullRequest({
      owner: 'wyxa',
      repository: 'app',
      repositoryId: 'R_1',
      base: 'main',
      headOwner: 'wyxa',
      headRepository: 'app',
      headBranch: 'feat/x',
      title: 'T',
      body: 'B',
      draft: false,
    });
    expect(result.ok).toBe(true);
    expect(result.value.number).toBe(9);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body.variables.input).toEqual({
      repositoryId: 'R_1',
      baseRefName: 'main',
      headRefName: 'feat/x',
      title: 'T',
      body: 'B',
      draft: false,
    });
  });

  it('uses owner:branch for cross-repository fork heads', async () => {
    const { githubPr, fetchMock } = loadGithubPr({
      fetchImpl: async () =>
        jsonResponse({
          data: { createPullRequest: { pullRequest: { number: 10, url: 'u', title: 't', state: 'open' } } },
        }),
    });
    const result = await githubPr.createGithubPullRequest({
      owner: 'base',
      repository: 'app',
      repositoryId: 'R_parent',
      base: 'develop',
      headOwner: 'wyxa',
      headRepository: 'app',
      headBranch: 'feat/fork',
      title: 'T',
      body: '',
      draft: true,
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body.variables.input.headRefName).toBe('wyxa:feat/fork');
    expect(body.variables.input.draft).toBe(true);
  });
});

describe('readGithubPrContextResult', () => {

  it('rejects ref names containing whitespace', async () => {
    const { githubPr } = loadGithubPr();
    const result = await githubPr.readGithubPrContextResult('/repo', {
      baseRemote: 'origin',
      baseBranch: 'main x',
      headBranch: 'feat/x',
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('invalid-ref');
  });
});
