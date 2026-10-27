// GitHub Pull Request integration.
// REST repository metadata + GraphQL PR templates / creation, plus a local
// `git log base..head` context reader for title/description prefill and AI
// generation. Reuses the github-auth.js token resolution and the git.js
// command helpers from the shared preload scope.

const githubPrRequestTimeoutMs = 15000;
const githubPrMetadataCacheTtlMs = 5 * 60 * 1000;
const githubPrMetadataCacheLimit = 32;
const githubPrContextCommitLimit = 200;
const githubPrContextFileLimit = 200;
const githubPrContextDiffStatLimit = 8000;
const githubPrContextDiffLimit = 64000;
const githubRepositoryNamePattern = /^[A-Za-z0-9_.-]+$/;

// 锁定文件与构建产物：diff 噪音大且无信息量，AI 上下文中的 diff 按这些
// pathspec 排除（文件清单仍完整展示，仅省略其 diff 内容）。
const githubPrNoisyPathPattern = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i;
const githubPrNoisyPathSuffixPattern = /(?:\.min\.js|(?:^|\/)(?:dist|node_modules)\/)/i;
const githubPrDiffExcludePathspecs = [
  ':(glob)**/package-lock.json',
  ':(glob)**/pnpm-lock.yaml',
  ':(glob)**/yarn.lock',
  ':(glob)**/bun.lockb',
  ':(glob)**/*.min.js',
  ':(glob)**/dist/**',
  ':(glob)**/node_modules/**',
];

const isGithubPrNoisyPath = (path) =>
  githubPrNoisyPathPattern.test(path) || githubPrNoisyPathSuffixPattern.test(path);

const githubPrTemplatesQuery = [
  'query PullRequestTemplates($owner: String!, $name: String!) {',
  '  repository(owner: $owner, name: $name) {',
  '    pullRequestTemplates { body }',
  '  }',
  '}',
].join('\n');

const githubPrCreateMutation = [
  'mutation CreatePullRequest($input: CreatePullRequestInput!) {',
  '  createPullRequest(input: $input) {',
  '    pullRequest { number title url isDraft state baseRefName headRefName }',
  '  }',
  '}',
].join('\n');

const githubPrRepositoryMetadataCache = new Map();

function githubPrFailure(code, message) {
  return { code, message };
}

function isGithubRepositoryNameValid(value) {
  const name = String(value || '').trim();
  return Boolean(name) && name !== '.' && name !== '..' && githubRepositoryNamePattern.test(name);
}

function isGithubRateLimited(response) {
  return (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  );
}

async function fetchGithubPrRequest(url, init = {}) {
  const resolvedToken = await resolveGithubToken();
  const attempt = (token) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), githubPrRequestTimeoutMs);
    return fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  };

  let response;
  try {
    response = await attempt(resolvedToken?.token);
  } catch (error) {
    const failure = error?.name === 'AbortError' ? '请求 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络后重试。';
    throw githubPrFailure('network-error', failure);
  }
  // A 401 means the resolved credential is dead: mark it rejected so the next
  // resolution skips it, then retry once with the refreshed credential.
  if (response.status === 401 && resolvedToken?.token) {
    markGithubTokenRejected(resolvedToken.token);
    const retryToken = await resolveGithubToken();
    try {
      response = await attempt(retryToken?.token);
    } catch (error) {
      const failure = error?.name === 'AbortError' ? '请求 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络后重试。';
      throw githubPrFailure('network-error', failure);
    }
    if (response.status === 401) {
      markGithubTokenRejected(retryToken.token);
    }
  }
  return response;
}

async function readGithubPrResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function githubPrHttpFailure(response) {
  if (response.status === 401) {
    return githubPrFailure('unauthorized', 'GitHub 凭证无效或已过期，请在设置中更新 GitHub 凭证。');
  }
  if (isGithubRateLimited(response)) {
    return githubPrFailure('rate-limited', 'GitHub API 已限流，请稍后重试。');
  }
  if (response.status === 403) {
    return githubPrFailure(
      'forbidden',
      'GitHub 拒绝了该请求，令牌可能缺少仓库（repo）权限，请检查 GitHub 凭证授权范围。',
    );
  }
  if (response.status === 404) {
    return githubPrFailure('not-found', 'GitHub 仓库不存在，或当前凭证无权访问该私有仓库。');
  }
  return githubPrFailure('http-error', `GitHub 返回 HTTP ${response.status}。`);
}

function normalizeGithubPrRepositoryParent(parent) {
  if (!parent || typeof parent !== 'object') return null;
  const owner = parent.owner?.login || '';
  const repository = parent.name || '';
  if (!owner || !repository) return null;
  return {
    owner,
    repository,
    nodeId: typeof parent.node_id === 'string' ? parent.node_id : '',
    defaultBranch: typeof parent.default_branch === 'string' ? parent.default_branch : '',
  };
}

async function readGithubRepositoryMetadataResult(owner, repository) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedRepository = String(repository || '').trim();
  if (!isGithubRepositoryNameValid(normalizedOwner) || !isGithubRepositoryNameValid(normalizedRepository)) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-repository', 'GitHub 仓库名称无效。') };
  }

  const cacheKey = `${normalizedOwner}/${normalizedRepository}`.toLowerCase();
  const cached = githubPrRepositoryMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, value: cached.value };
  }

  let response;
  try {
    response = await fetchGithubPrRequest(
      `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepository)}`,
    );
  } catch (error) {
    return { ok: false, value: null, failure: githubPrFailure('network-error', error.message || '读取 GitHub 仓库信息失败。') };
  }
  if (!response.ok) {
    return { ok: false, value: null, failure: githubPrHttpFailure(response) };
  }
  const payload = await readGithubPrResponseJson(response);
  if (!payload || typeof payload.node_id !== 'string' || typeof payload.default_branch !== 'string') {
    return { ok: false, value: null, failure: githubPrFailure('invalid-response', 'GitHub 仓库信息响应格式无效。') };
  }

  const value = {
    owner: normalizedOwner,
    repository: normalizedRepository,
    nodeId: payload.node_id,
    defaultBranch: payload.default_branch,
    isFork: payload.fork === true,
    parent: normalizeGithubPrRepositoryParent(payload.parent),
  };
  githubPrRepositoryMetadataCache.delete(cacheKey);
  githubPrRepositoryMetadataCache.set(cacheKey, { value, expiresAt: Date.now() + githubPrMetadataCacheTtlMs });
  while (githubPrRepositoryMetadataCache.size > githubPrMetadataCacheLimit) {
    const oldestKey = githubPrRepositoryMetadataCache.keys().next().value;
    if (!oldestKey) break;
    githubPrRepositoryMetadataCache.delete(oldestKey);
  }
  return { ok: true, value };
}

async function runGithubPrGraphql(query, variables) {
  let response;
  try {
    response = await fetchGithubPrRequest('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return { ok: false, failure: githubPrFailure('network-error', error.message || '请求 GitHub GraphQL 接口失败。') };
  }
  if (!response.ok) {
    return { ok: false, failure: githubPrHttpFailure(response) };
  }
  const payload = await readGithubPrResponseJson(response);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, failure: githubPrFailure('invalid-response', 'GraphQL 响应格式无效。') };
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const firstError = payload.errors[0] || {};
    const type = typeof firstError.type === 'string' ? firstError.type : '';
    const message = typeof firstError.message === 'string' ? firstError.message : 'GitHub GraphQL 调用失败。';
    if (type === 'NOT_FOUND') {
      return { ok: false, failure: githubPrFailure('not-found', 'GitHub 仓库不存在，或当前凭证无权访问。') };
    }
    if (type === 'FORBIDDEN' || /forbidden/i.test(message)) {
      return { ok: false, failure: githubPrFailure('forbidden', 'GitHub 拒绝了该请求，请检查令牌权限。') };
    }
    return { ok: false, failure: githubPrFailure('graphql-error', `GitHub GraphQL 调用失败：${message}`) };
  }
  if (!payload.data || typeof payload.data !== 'object') {
    return { ok: false, failure: githubPrFailure('invalid-response', 'GraphQL 响应缺少数据。') };
  }
  return { ok: true, data: payload.data };
}

async function readGithubPullRequestTemplatesResult(owner, repository) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedRepository = String(repository || '').trim();
  if (!isGithubRepositoryNameValid(normalizedOwner) || !isGithubRepositoryNameValid(normalizedRepository)) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-repository', 'GitHub 仓库名称无效。') };
  }

  const result = await runGithubPrGraphql(githubPrTemplatesQuery, {
    owner: normalizedOwner,
    name: normalizedRepository,
  });
  if (!result.ok) {
    return { ok: false, value: null, failure: result.failure };
  }
  const templates = result.data.repository?.pullRequestTemplates;
  const bodies = Array.isArray(templates)
    ? templates
        .map((template) => (template && typeof template.body === 'string' ? template.body : ''))
        .filter((body) => body.trim())
    : [];
  return { ok: true, value: bodies };
}

function normalizeGithubPullRequestPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const numberValue = Number(payload.number);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
  const url = typeof payload.html_url === 'string' ? payload.html_url : '';
  const graphqlUrl = typeof payload.url === 'string' ? payload.url : '';
  const resolvedUrl = url || graphqlUrl;
  return {
    number: numberValue,
    title: typeof payload.title === 'string' ? payload.title : `#${numberValue}`,
    body: typeof payload.body === 'string' ? payload.body : '',
    url: resolvedUrl,
    isDraft: payload.draft === true || payload.isDraft === true,
    state: payload.state === 'closed' || payload.state === 'merged' ? 'closed' : 'open',
    baseBranch: typeof payload.base?.ref === 'string' ? payload.base.ref : '',
    headBranch: typeof payload.head?.ref === 'string' ? payload.head.ref : '',
  };
}

async function readGithubOpenPullRequestResult(owner, repository, headOwner, branch) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedRepository = String(repository || '').trim();
  const normalizedHeadOwner = String(headOwner || '').trim();
  const normalizedBranch = String(branch || '').trim();
  if (
    !isGithubRepositoryNameValid(normalizedOwner) ||
    !isGithubRepositoryNameValid(normalizedRepository) ||
    !isGithubRepositoryNameValid(normalizedHeadOwner) ||
    !normalizedBranch
  ) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-repository', 'GitHub 仓库或分支名称无效。') };
  }

  let response;
  try {
    response = await fetchGithubPrRequest(
      `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(
        normalizedRepository,
      )}/pulls?head=${encodeURIComponent(`${normalizedHeadOwner}:${normalizedBranch}`)}&state=open&per_page=10`,
    );
  } catch (error) {
    return { ok: false, value: null, failure: githubPrFailure('network-error', error.message || '查询 GitHub PR 失败。') };
  }
  if (!response.ok) {
    return { ok: false, value: null, failure: githubPrHttpFailure(response) };
  }
  const payload = await readGithubPrResponseJson(response);
  if (!Array.isArray(payload)) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-response', 'GitHub PR 查询响应格式无效。') };
  }
  const match = payload
    .map((item) => normalizeGithubPullRequestPayload(item))
    .find((item) => item && item.state === 'open' && (!item.headBranch || item.headBranch === normalizedBranch));
  return { ok: true, value: match || null };
}

async function updateGithubPullRequest(input) {
  const owner = String(input?.owner || '').trim();
  const repository = String(input?.repository || '').trim();
  const number = input?.number;
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  if (
    !isGithubRepositoryNameValid(owner) ||
    !isGithubRepositoryNameValid(repository) ||
    !Number.isSafeInteger(number) || number <= 0 ||
    !title ||
    typeof input?.body !== 'string'
  ) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-input', '更新 PR 的参数无效，标题不能为空。') };
  }
  let response;
  try {
    response = await fetchGithubPrRequest(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${number}`,
      { method: 'PATCH', body: JSON.stringify({ title, body: input.body }) },
    );
  } catch (error) {
    return { ok: false, value: null, failure: githubPrFailure('network-error', error.message || '保存 PR 修改失败。') };
  }
  if (!response.ok) return { ok: false, value: null, failure: githubPrHttpFailure(response) };
  const payload = await readGithubPrResponseJson(response);
  const pullRequest = normalizeGithubPullRequestPayload(payload);
  if (!pullRequest || pullRequest.number !== number || typeof payload.title !== 'string' || !payload.title.trim() || (payload.body !== null && typeof payload.body !== 'string')) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-response', 'GitHub 更新 PR 响应格式无效。') };
  }
  return { ok: true, value: pullRequest };
}

async function createGithubPullRequest(input) {
  const normalized = {
    owner: String(input?.owner || '').trim(),
    repository: String(input?.repository || '').trim(),
    repositoryId: String(input?.repositoryId || '').trim(),
    base: String(input?.base || '').trim(),
    headOwner: String(input?.headOwner || '').trim(),
    headRepository: String(input?.headRepository || '').trim(),
    headBranch: String(input?.headBranch || '').trim(),
    title: String(input?.title || '').trim(),
    body: typeof input?.body === 'string' ? input.body : '',
    draft: input?.draft === true,
  };
  if (!normalized.owner || !normalized.repository || !normalized.base || !normalized.headBranch) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-input', '创建 PR 缺少必要参数。') };
  }
  let repositoryId = normalized.repositoryId;
  if (!repositoryId) {
    const metadataResult = await readGithubRepositoryMetadataResult(normalized.owner, normalized.repository);
    if (!metadataResult.ok) {
      return { ok: false, value: null, failure: metadataResult.failure };
    }
    repositoryId = metadataResult.value.nodeId;
  }
  // Cross-repository heads (fork -> upstream) use the "owner:branch" form.
  const headRefName =
    normalized.headOwner.toLowerCase() === normalized.owner.toLowerCase()
      ? normalized.headBranch
      : `${normalized.headOwner}:${normalized.headBranch}`;

  const result = await runGithubPrGraphql(githubPrCreateMutation, {
    input: {
      repositoryId,
      baseRefName: normalized.base,
      headRefName,
      title: normalized.title,
      body: normalized.body,
      draft: normalized.draft,
    },
  });
  if (!result.ok) {
    return { ok: false, value: null, failure: result.failure };
  }
  const pullRequest = normalizeGithubPullRequestPayload(result.data.createPullRequest?.pullRequest);
  if (!pullRequest) {
    return { ok: false, value: null, failure: githubPrFailure('invalid-response', 'GitHub 创建 PR 响应格式无效。') };
  }
  return { ok: true, value: pullRequest };
}

function parseGithubPrContextCommits(output) {
  const commits = [];
  const rawOutput = String(output || '');
  if (!rawOutput.trim()) return commits;

  rawOutput.split(gitCommitRecordSeparator).forEach((record) => {
    const normalizedRecord = record.trimEnd();
    if (!normalizedRecord.trim()) return;
    const fields = normalizedRecord.split(gitCommitFieldSeparator);
    const [hash, parents, author, date, subject, message] = fields;
    if (!hash || hash.length < 7) return;
    commits.push({
      hash,
      parents: String(parents || '')
        .split(' ')
        .map((parent) => parent.trim())
        .filter(Boolean),
      author: String(author || ''),
      date: String(date || ''),
      subject: String(subject || ''),
      message: String(message || ''),
    });
  });
  return commits;
}

function parseGithubPrContextNumstat(output) {
  const files = [];
  const rawOutput = String(output || '');
  if (!rawOutput.trim()) return { files, truncated: false };

  rawOutput.split(/\r?\n/).forEach((line) => {
    if (files.length > githubPrContextFileLimit) return;
    const segments = line.split('\t');
    if (segments.length < 3) return;
    const [additions, deletions, ...pathSegments] = segments;
    const path = pathSegments.join('\t').trim();
    if (!path) return;
    const binary = additions === '-' || deletions === '-';
    files.push({
      path,
      additions: binary || !/^\d+$/.test(additions) ? null : Number(additions),
      deletions: binary || !/^\d+$/.test(deletions) ? null : Number(deletions),
      binary,
    });
  });
  return { files, truncated: files.length > githubPrContextFileLimit };
}

async function readGithubPrContextResult(projectPath, options = {}) {
  const baseRemote = String(options.baseRemote || '').trim();
  const baseBranch = String(options.baseBranch || '').trim();
  const headBranch = String(options.headBranch || '').trim();
  if (!baseRemote || !baseBranch || !headBranch || /[\s]/.test(`${baseRemote}${baseBranch}${headBranch}`)) {
    return {
      ok: false,
      value: null,
      failure: {
        code: 'invalid-ref',
        operation: 'history',
        message: 'PR 上下文参数无效：远端、基点分支或源分支名称不合法。',
      },
    };
  }

  const rootResult = await findGitRootAsyncResult(projectPath);
  if (!rootResult.ok) {
    return { ok: false, value: null, failure: rootResult.failure };
  }
  const repositoryPath = rootResult.repositoryPath;
  const baseRef = `${baseRemote}/${baseBranch}`;
  const headRef = `refs/heads/${headBranch}`;
  const invalidOutputFailure = (message) => ({
    code: 'invalid-output',
    operation: 'history',
    message,
  });

  const [baseCommitResult, headCommitResult] = await Promise.all([
    runGitAsyncResult(repositoryPath, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]),
    runGitAsyncResult(repositoryPath, ['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`]),
  ]);
  if (!baseCommitResult.ok || !baseCommitResult.stdout.trim()) {
    return {
      ok: false,
      value: null,
      failure: {
        code: 'missing-base-ref',
        operation: 'history',
        message: `本地没有 ${baseRef}，请先执行 Fetch 后重试。`,
      },
    };
  }
  if (!headCommitResult.ok || !headCommitResult.stdout.trim()) {
    return {
      ok: false,
      value: null,
      failure: {
        code: 'missing-head-ref',
        operation: 'history',
        message: `本地分支 ${headBranch} 不存在或没有提交。`,
      },
    };
  }

  const mergeBaseResult = await runGitAsyncResult(repositoryPath, ['merge-base', baseRef, headRef]);
  const mergeBase = mergeBaseResult.ok ? mergeBaseResult.stdout.trim() : '';
  if (!mergeBase) {
    return {
      ok: false,
      value: null,
      failure: {
        code: 'no-merge-base',
        operation: 'history',
        message: `${baseRef} 与 ${headBranch} 没有共同祖先，无法生成 PR 上下文。`,
      },
    };
  }

  const commitRange = `${mergeBase}..${headRef}`;
  const logFormat = [
    gitCommitRecordSeparator,
    '%H',
    gitCommitFieldSeparator,
    '%P',
    gitCommitFieldSeparator,
    '%an',
    gitCommitFieldSeparator,
    '%ad',
    gitCommitFieldSeparator,
    '%s',
    gitCommitFieldSeparator,
    '%B',
    gitCommitFieldSeparator,
  ].join('');
  const [logResult, totalResult, nonMergeResult, numstatResult, diffStatResult, diffResult] = await Promise.all([
    runGitAsyncResult(repositoryPath, [
      'log',
      '--topo-order',
      `--max-count=${githubPrContextCommitLimit + 1}`,
      `--pretty=format:${logFormat}`,
      '--date=iso-strict',
      commitRange,
    ]),
    runGitAsyncResult(repositoryPath, ['rev-list', '--count', commitRange]),
    runGitAsyncResult(repositoryPath, ['rev-list', '--count', '--no-merges', commitRange]),
    runGitAsyncResult(repositoryPath, ['diff', '--numstat', '-M', commitRange]),
    runGitAsyncResult(repositoryPath, ['diff', '--stat', commitRange]),
    runGitAsyncResult(repositoryPath, [
      'diff',
      '-M',
      commitRange,
      '--',
      '.',
      ...githubPrDiffExcludePathspecs,
    ]),
  ]);
  if (!logResult.ok) {
    return { ok: false, value: null, failure: createGitReadFailure('history', logResult, '读取 PR 提交范围失败') };
  }
  if (!totalResult.ok || !/^\d+$/.test(totalResult.stdout.trim())) {
    return { ok: false, value: null, failure: invalidOutputFailure('读取 PR 范围提交数量失败。') };
  }

  const commits = parseGithubPrContextCommits(logResult.stdout);
  const numstat = parseGithubPrContextNumstat(numstatResult.ok ? numstatResult.stdout : '');
  const diffStatRaw = diffStatResult.ok ? diffStatResult.stdout.trim() : '';
  const diffStatTruncated = diffStatRaw.length > githubPrContextDiffStatLimit;
  const diffStat = diffStatTruncated
    ? `${diffStatRaw.slice(0, githubPrContextDiffStatLimit)}\n[diffstat 已截断]`
    : diffStatRaw;
  const truncatedDiff = truncateGitDiff(diffResult.ok ? diffResult.stdout : '', githubPrContextDiffLimit);

  return {
    ok: true,
    value: {
      baseRemote,
      baseBranch,
      headBranch,
      mergeBase,
      commits,
      commitsTruncated: commits.length > githubPrContextCommitLimit,
      totalCommits: Number(totalResult.stdout.trim()),
      nonMergeCommitCount: nonMergeResult.ok && /^\d+$/.test(nonMergeResult.stdout.trim())
        ? Number(nonMergeResult.stdout.trim())
        : commits.length,
      files: numstat.files.slice(0, githubPrContextFileLimit),
      filesTruncated: numstat.truncated,
      noisyDiffExcluded: numstat.files.some((file) => isGithubPrNoisyPath(file.path)),
      diffStat,
      diffStatTruncated,
      diff: truncatedDiff.diff,
      diffTruncated: truncatedDiff.truncated,
    },
  };
}
