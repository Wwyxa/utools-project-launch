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

const repositoryMetadataPayload = {
  node_id: 'R_1',
  default_branch: 'main',
  fork: false,
  parent: null,
  owner: { login: 'wyxa' },
  name: 'app',
};

const forkMetadataPayload = {
  node_id: 'R_fork',
  default_branch: 'main',
  fork: true,
  parent: {
    node_id: 'R_parent',
    default_branch: 'develop',
    owner: { login: 'base' },
    name: 'app',
  },
  owner: { login: 'wyxa' },
  name: 'app',
};

type LoadedGithubPr = {
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

describe('readGithubRepositoryMetadataResult', () => {
  it('normalizes repository metadata and caches repeat calls', async () => {
    const { githubPr, fetchMock } = loadGithubPr({
      fetchImpl: async () => jsonResponse(repositoryMetadataPayload),
    });
    const first = await githubPr.readGithubRepositoryMetadataResult('wyxa', 'app');
    expect(first.ok).toBe(true);
    expect(first.value).toEqual({
      owner: 'wyxa',
      repository: 'app',
      nodeId: 'R_1',
      defaultBranch: 'main',
      isFork: false,
      parent: null,
    });
    await githubPr.readGithubRepositoryMetadataResult('wyxa', 'app');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/wyxa/app',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghp_testtoken' }) }),
    );
  });

  it('keeps fork parent metadata', async () => {
    const { githubPr } = loadGithubPr({ fetchImpl: async () => jsonResponse(forkMetadataPayload) });
    const result = await githubPr.readGithubRepositoryMetadataResult('wyxa', 'app');
    expect(result.value.isFork).toBe(true);
    expect(result.value.parent).toEqual({
      owner: 'base',
      repository: 'app',
      nodeId: 'R_parent',
      defaultBranch: 'develop',
    });
  });

  it('maps 404 to a friendly failure', async () => {
    const { githubPr } = loadGithubPr({ fetchImpl: async () => jsonResponse({ message: 'nope' }, 404) });
    const result = await githubPr.readGithubRepositoryMetadataResult('wyxa', 'missing');
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('not-found');
  });

  it('rejects invalid repository names without a request', async () => {
    const { githubPr, fetchMock } = loadGithubPr();
    const result = await githubPr.readGithubRepositoryMetadataResult('../etc', 'app');
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('invalid-repository');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the token rejected and retries once on 401', async () => {
    let calls = 0;
    const { githubPr, markGithubTokenRejected } = loadGithubPr({
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? jsonResponse({ message: 'bad token' }, 401) : jsonResponse(repositoryMetadataPayload);
      },
    });
    const result = await githubPr.readGithubRepositoryMetadataResult('wyxa', 'app');
    expect(result.ok).toBe(true);
    expect(markGithubTokenRejected).toHaveBeenCalledWith('ghp_testtoken');
    expect(calls).toBe(2);
  });
});

describe('readGithubPullRequestTemplatesResult', () => {
  it('returns template bodies from GraphQL', async () => {
    const { githubPr, fetchMock } = loadGithubPr({
      fetchImpl: async () =>
        jsonResponse({ data: { repository: { pullRequestTemplates: [{ body: '## A' }, { body: '## B' }] } } }),
    });
    const result = await githubPr.readGithubPullRequestTemplatesResult('wyxa', 'app');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(['## A', '## B']);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe('https://api.github.com/graphql');
    expect(String((request[1] as { body: string }).body)).toContain('pullRequestTemplates');
  });

  it('returns an empty list when the repository has no templates', async () => {
    const { githubPr } = loadGithubPr({
      fetchImpl: async () => jsonResponse({ data: { repository: { pullRequestTemplates: null } } }),
    });
    const result = await githubPr.readGithubPullRequestTemplatesResult('wyxa', 'app');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('surfaces GraphQL errors as failures', async () => {
    const { githubPr } = loadGithubPr({
      fetchImpl: async () => jsonResponse({ errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] }),
    });
    const result = await githubPr.readGithubPullRequestTemplatesResult('wyxa', 'app');
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('not-found');
  });
});

describe('readGithubOpenPullRequestResult', () => {
  it('matches the open PR for the head branch, or null when none exists', async () => {
    const empty = loadGithubPr({ fetchImpl: async () => jsonResponse([]) });
    const emptyResult = await empty.githubPr.readGithubOpenPullRequestResult('wyxa', 'app', 'wyxa', 'feat/x');
    expect(emptyResult.ok).toBe(true);
    expect(emptyResult.value).toBeNull();

    const { githubPr, fetchMock } = loadGithubPr({
      fetchImpl: async () =>
        jsonResponse([
          {
            number: 7,
            title: 'Existing PR',
            html_url: 'https://github.com/wyxa/app/pull/7',
            draft: true,
            state: 'open',
            base: { ref: 'main' },
            head: { ref: 'feat/x' },
          },
        ]),
    });
    const result = await githubPr.readGithubOpenPullRequestResult('wyxa', 'app', 'wyxa', 'feat/x');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      number: 7,
      title: 'Existing PR',
      url: 'https://github.com/wyxa/app/pull/7',
      isDraft: true,
      state: 'open',
      baseBranch: 'main',
      headBranch: 'feat/x',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/wyxa/app/pulls?head=wyxa%3Afeat%2Fx&state=open&per_page=10',
      expect.anything(),
    );
  });
});

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
  const recordSeparator = '\x1e';
  const fieldSeparator = '\x1f';
  const firstHash = 'b'.repeat(40);
  const secondHash = 'a'.repeat(40);
  const parentHash = 'c'.repeat(40);
  const logOutput = [
    `${recordSeparator}${firstHash}${fieldSeparator}${parentHash}${fieldSeparator}Dev${fieldSeparator}2026-10-25T10:00:00+08:00${fieldSeparator}feat: second${fieldSeparator}feat: second${fieldSeparator}`,
    `${recordSeparator}${secondHash}${fieldSeparator}${fieldSeparator}Dev${fieldSeparator}2026-10-24T10:00:00+08:00${fieldSeparator}feat: first${fieldSeparator}feat: first\n\nBody of first.${fieldSeparator}`,
  ].join('');

  const gitDispatcher = (args: string[]) => {
    const joined = args.join(' ');
    if (args[0] === 'rev-parse') return { ok: true, stdout: 'sha' };
    if (args[0] === 'merge-base') return { ok: true, stdout: 'base000' };
    if (args[0] === 'log') return { ok: true, stdout: logOutput };
    if (joined.includes('rev-list --count --no-merges')) return { ok: true, stdout: '2' };
    if (args[0] === 'rev-list') return { ok: true, stdout: '2' };
    if (args[0] === 'diff' && args.includes('--numstat'))
      return { ok: true, stdout: '3\t1\tsrc/a.ts\n-\t-\tassets/logo.png\n900\t12\tpackage-lock.json' };
    if (args[0] === 'diff' && args.includes('--stat')) return { ok: true, stdout: ' 2 files changed, 10 insertions(+)' };
    if (args[0] === 'diff') return { ok: true, stdout: 'diff --git a/x b/x' };
    return undefined;
  };

  it('parses commits, files, counts, and diffs for the base..head range', async () => {
    const { githubPr, runGitAsyncResult } = loadGithubPr({ gitCommands: gitDispatcher });
    const result = await githubPr.readGithubPrContextResult('/repo', {
      baseRemote: 'origin',
      baseBranch: 'main',
      headBranch: 'feat/x',
    });
    expect(result.ok).toBe(true);
    expect(result.value.commits).toEqual([
      {
        hash: firstHash,
        parents: [parentHash],
        author: 'Dev',
        date: '2026-10-25T10:00:00+08:00',
        subject: 'feat: second',
        message: 'feat: second',
      },
      {
        hash: secondHash,
        parents: [],
        author: 'Dev',
        date: '2026-10-24T10:00:00+08:00',
        subject: 'feat: first',
        message: 'feat: first\n\nBody of first.',
      },
    ]);
    expect(result.value.totalCommits).toBe(2);
    expect(result.value.nonMergeCommitCount).toBe(2);
    expect(result.value.files).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1, binary: false },
      { path: 'assets/logo.png', additions: null, deletions: null, binary: true },
      { path: 'package-lock.json', additions: 900, deletions: 12, binary: false },
    ]);
    expect(result.value.filesTruncated).toBe(false);
    expect(result.value.noisyDiffExcluded).toBe(true);
    expect(result.value.diffStat).toContain('2 files changed');
    expect(result.value.diff).toBe('diff --git a/x b/x');
    expect(result.value.diffTruncated).toBe(false);
    const logCall = runGitAsyncResult.mock.calls.find((call) => call[1][0] === 'log');
    expect(logCall?.[1].join(' ')).toContain('base000..refs/heads/feat/x');
    const fullDiffCall = runGitAsyncResult.mock.calls.find(
      (call) => call[1][0] === 'diff' && !call[1].includes('--stat') && !call[1].includes('--numstat'),
    );
    expect(fullDiffCall?.[1]).toContain(':(glob)**/package-lock.json');
    expect(fullDiffCall?.[1]).toContain(':(glob)**/node_modules/**');
  });

  it('fails with a friendly message when the local base ref is missing', async () => {
    const { githubPr } = loadGithubPr({
      gitCommands: (args) => {
        if (args[0] === 'rev-parse' && args.includes('origin/main^{commit}')) return { ok: true, stdout: '' };
        return gitDispatcher(args);
      },
    });
    const result = await githubPr.readGithubPrContextResult('/repo', {
      baseRemote: 'origin',
      baseBranch: 'main',
      headBranch: 'feat/x',
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('missing-base-ref');
    expect(result.failure?.message).toContain('origin/main');
  });

  it('fails when the branches share no merge base', async () => {
    const { githubPr } = loadGithubPr({
      gitCommands: (args) => {
        if (args[0] === 'merge-base') return { ok: true, stdout: '' };
        return gitDispatcher(args);
      },
    });
    const result = await githubPr.readGithubPrContextResult('/repo', {
      baseRemote: 'origin',
      baseBranch: 'main',
      headBranch: 'feat/x',
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('no-merge-base');
  });

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
