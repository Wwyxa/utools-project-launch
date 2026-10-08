import type { Project, ProjectGitFileChange, ProjectGitSnapshot, ProjectGitRepositoryContext, ProjectGitReadOperation, ProjectGitReadFailure, ProjectGitStatusSnapshot, ProjectBridgeGitWorkingTreeSnapshot, ProjectGitCommitPage } from "../../types";

export const gitSnapshotRefreshPromises = new Map<string, Promise<void>>();

export const gitStatusRefreshPromises = new Map<string, Promise<void>>();

export const gitWorkingTreeRefreshPromises = new Map<string, Promise<void>>();

export const gitLoadMorePromises = new Map<string, Promise<void>>();

export const gitWorkspaceRefreshPromises = new Map<string, Promise<void>>();

export const gitWriteLocks = new Map<string, Promise<void>>();

export const gitSnapshotRefreshTokens = new Map<string, symbol>();

export const gitStatusRefreshTokens = new Map<string, symbol>();

export const gitWorkingTreeRefreshTokens = new Map<string, symbol>();

export const gitLoadMoreTokens = new Map<string, symbol>();

export const gitWorkspaceRefreshTokens = new Map<string, symbol>();

export const gitMutationVersions = new Map<string, number>();

export const gitRefMutationVersions = new Map<string, number>();

export const queueGitWriteLock = (contextKey: string) => {
  const previousWrite = gitWriteLocks.get(contextKey) || Promise.resolve();
  let release: () => void = () => { };
  const currentWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queuedWrite = previousWrite.catch(() => undefined).then(() => currentWrite);
  gitWriteLocks.set(contextKey, queuedWrite);
  return {
    waitForPrevious: previousWrite.catch(() => undefined),
    release: () => {
      release();
      if (gitWriteLocks.get(contextKey) === queuedWrite) {
        gitWriteLocks.delete(contextKey);
      }
    },
  };
};

export function gitMutationVersion(contextKey: string) {
  return gitMutationVersions.get(contextKey) || 0;
}

export function bumpGitMutationVersion(contextKey: string) {
  gitMutationVersions.set(contextKey, gitMutationVersion(contextKey) + 1);
}

export function gitRefMutationVersion(projectId: string) {
  return gitRefMutationVersions.get(projectId) || 0;
}

export function bumpGitRefMutationVersion(projectId: string) {
  gitRefMutationVersions.set(projectId, gitRefMutationVersion(projectId) + 1);
}

export function clearGitRepositoryCoordination(projectId: string, preserveStatusRefresh = false) {
  const contextPrefix = `${projectId}::`;
  [
    gitSnapshotRefreshPromises,
    gitStatusRefreshPromises,
    gitWorkingTreeRefreshPromises,
    gitLoadMorePromises,
    gitSnapshotRefreshTokens,
    gitStatusRefreshTokens,
    gitWorkingTreeRefreshTokens,
    gitLoadMoreTokens,
    gitMutationVersions,
  ].forEach((state) => {
    if (preserveStatusRefresh && (state === gitStatusRefreshPromises || state === gitStatusRefreshTokens)) return;
    [...state.keys()].forEach((key) => {
      if (key.startsWith(contextPrefix)) state.delete(key);
    });
  });
  gitRefMutationVersions.delete(projectId);
}

export function clearGitRepositoryRecord(record: Record<string, unknown>, projectId: string) {
  const contextPrefix = `${projectId}::`;
  Object.keys(record).forEach((key) => {
    if (key.startsWith(contextPrefix)) delete record[key];
  });
}

export function clearGitSnapshotForRepository(
  projects: Project[],
  stagedFiles: Record<string, ProjectGitFileChange[]>,
  repositorySnapshots: Record<string, ProjectGitSnapshot | undefined>,
  projectId: string,
  context: ProjectGitRepositoryContext,
) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return false;
  if (context.target.kind === "main") {
    project.git = null;
    project.gitLatestCommitAt = "";
    stagedFiles[projectId] = [];
  } else {
    delete repositorySnapshots[context.contextKey];
  }
  return true;
}

export type GitReadFailureState = Partial<Record<ProjectGitReadOperation, ProjectGitReadFailure>>;

export function setGitReadFailure(
  record: Record<string, GitReadFailureState | undefined>,
  contextKey: string,
  failure: ProjectGitReadFailure,
) {
  record[contextKey] = { ...(record[contextKey] || {}), [failure.operation]: failure };
}

export function clearGitReadFailure(
  record: Record<string, GitReadFailureState | undefined>,
  contextKey: string,
  operation?: ProjectGitReadOperation,
) {
  if (!operation) {
    delete record[contextKey];
    return;
  }

  const current = record[contextKey];
  if (!current) return;
  const next = { ...current };
  delete next[operation];
  if (Object.keys(next).length === 0) delete record[contextKey];
  else record[contextKey] = next;
}

export function createGitReadFailureFromError(
  operation: ProjectGitReadOperation,
  error: unknown,
  fallbackMessage: string,
): ProjectGitReadFailure {
  return {
    code: "command-failed",
    operation,
    message: error instanceof Error && error.message ? error.message : fallbackMessage,
  };
}

export const normalizeGitCommitSkip = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;

export const normalizeGitCommitCount = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;

export function isCompleteGitSnapshot(snapshot: ProjectGitSnapshot | null | undefined): snapshot is ProjectGitSnapshot {
  return Boolean(
    snapshot &&
    Array.isArray(snapshot.commits) &&
    Number.isSafeInteger(snapshot.commitCount) &&
    snapshot.commitCount >= 0,
  );
}

export function normalizeGitSnapshot(snapshot: ProjectGitSnapshot | null | undefined): ProjectGitSnapshot | null {
  if (!isCompleteGitSnapshot(snapshot)) {
    return null;
  }

  const commits = snapshot.commits;

  return {
    branch: snapshot.branch || "main",
    headHash: snapshot.headHash || "",
    isDetachedHead: Boolean(snapshot.isDetachedHead),
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
    files: snapshot.files || [],
    commits,
    commitCount: normalizeGitCommitCount(snapshot.commitCount, 0),
    branches: snapshot.branches || [],
    remotes: snapshot.remotes || [],
    remoteBranches: snapshot.remoteBranches || [],
    upstream: snapshot.upstream || null,
    base: snapshot.base || null,
    mergeInProgress: Boolean(snapshot.mergeInProgress),
    mergeCommitMessage: snapshot.mergeCommitMessage || null,
    hasMoreCommits: snapshot.hasMoreCommits || false,
    nextCommitSkip: normalizeGitCommitSkip(snapshot.nextCommitSkip, commits.length),
    repositoryPath: snapshot.repositoryPath || "",
    lastRefreshedAt: snapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: snapshot.statusText || "OK",
  };
}

export function gitHistorySnapshotSignature(
  snapshot: ProjectGitSnapshot | null | undefined,
  commits = snapshot?.commits || [],
): string {
  if (!snapshot) return "";

  return JSON.stringify({
    branch: snapshot.branch || "",
    headHash: snapshot.headHash || "",
    isDetachedHead: Boolean(snapshot.isDetachedHead),
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
    commitCount: snapshot.commitCount || 0,
    commits: commits.map((commit) => ({
      hash: commit.hash,
      refs: commit.refs || "",
      refNames: (commit.refNames || []).map((ref) => [ref.kind, ref.name, Boolean(ref.head)]),
    })),
    branches: (snapshot.branches || []).map((branch) => [branch.name, Boolean(branch.current)]),
    remotes: (snapshot.remotes || []).map((remote) => [remote.name, remote.fetchUrl, remote.pushUrl]),
    remoteBranches: (snapshot.remoteBranches || []).map((branch) => [branch.remote, branch.branch, branch.ref, branch.commitHash || ""]),
    upstream: snapshot.upstream
      ? [
        snapshot.upstream.remote,
        snapshot.upstream.branch,
        snapshot.upstream.ref,
        snapshot.upstream.ahead,
        snapshot.upstream.behind,
      ]
      : null,
    base: snapshot.base ? [snapshot.base.remote, snapshot.base.branch, snapshot.base.ref] : null,
  });
}

export function gitHistoryPageMatches(currentSnapshot: ProjectGitSnapshot, nextSnapshot: ProjectGitSnapshot): boolean {
  const currentCommits = currentSnapshot.commits || [];
  const nextCommits = nextSnapshot.commits || [];
  if (currentSnapshot.commitCount !== nextSnapshot.commitCount || nextCommits.length > currentCommits.length) {
    return false;
  }

  return (
    gitHistorySnapshotSignature(currentSnapshot, currentCommits.slice(0, nextCommits.length)) ===
    gitHistorySnapshotSignature(nextSnapshot, nextCommits)
  );
}

export function mergeGitSnapshotPreservingHistory(
  currentSnapshot: ProjectGitSnapshot | null | undefined,
  nextSnapshot: ProjectGitSnapshot | null,
): ProjectGitSnapshot | null {
  if (!currentSnapshot || !nextSnapshot) return nextSnapshot;
  if (!gitHistoryPageMatches(currentSnapshot, nextSnapshot)) {
    return nextSnapshot;
  }

  currentSnapshot.files = nextSnapshot.files;
  currentSnapshot.base = nextSnapshot.base;
  currentSnapshot.mergeInProgress = nextSnapshot.mergeInProgress;
  currentSnapshot.mergeCommitMessage = nextSnapshot.mergeCommitMessage;
  currentSnapshot.repositoryPath = nextSnapshot.repositoryPath;
  currentSnapshot.lastRefreshedAt = nextSnapshot.lastRefreshedAt;
  currentSnapshot.statusText = nextSnapshot.statusText;
  return currentSnapshot;
}

export function mergeGitStatusSnapshot(
  currentSnapshot: ProjectGitSnapshot | null | undefined,
  statusSnapshot: ProjectGitStatusSnapshot,
): ProjectGitSnapshot | null {
  if (!currentSnapshot) return null;

  const nextSnapshot: ProjectGitSnapshot = {
    branch: statusSnapshot.branch || currentSnapshot.branch || "main",
    headHash: statusSnapshot.headHash || "",
    isDetachedHead: Boolean(statusSnapshot.isDetachedHead),
    ahead: statusSnapshot.ahead || 0,
    behind: statusSnapshot.behind || 0,
    files: statusSnapshot.files || [],
    commits: currentSnapshot.commits || [],
    commitCount: currentSnapshot.commitCount ?? 0,
    branches: statusSnapshot.branches || currentSnapshot.branches || [],
    remotes: statusSnapshot.remotes || currentSnapshot.remotes || [],
    remoteBranches: statusSnapshot.remoteBranches || currentSnapshot.remoteBranches || [],
    upstream: statusSnapshot.upstream || null,
    base: statusSnapshot.base || null,
    mergeInProgress: statusSnapshot.mergeInProgress ?? (currentSnapshot.mergeInProgress || false),
    mergeCommitMessage: statusSnapshot.mergeCommitMessage ?? currentSnapshot.mergeCommitMessage ?? null,
    hasMoreCommits: currentSnapshot.hasMoreCommits || false,
    nextCommitSkip: currentSnapshot.nextCommitSkip ?? currentSnapshot.commits.length,
    repositoryPath: statusSnapshot.repositoryPath || currentSnapshot.repositoryPath || "",
    lastRefreshedAt: statusSnapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: statusSnapshot.statusText || currentSnapshot.statusText || "OK",
  };

  if (gitHistorySnapshotSignature(currentSnapshot) === gitHistorySnapshotSignature(nextSnapshot)) {
    currentSnapshot.files = nextSnapshot.files;
    currentSnapshot.base = nextSnapshot.base;
    currentSnapshot.mergeInProgress = nextSnapshot.mergeInProgress;
    currentSnapshot.mergeCommitMessage = nextSnapshot.mergeCommitMessage;
    currentSnapshot.repositoryPath = nextSnapshot.repositoryPath;
    currentSnapshot.lastRefreshedAt = nextSnapshot.lastRefreshedAt;
    currentSnapshot.statusText = nextSnapshot.statusText;
    return currentSnapshot;
  }

  Object.assign(currentSnapshot, {
    branch: nextSnapshot.branch,
    headHash: nextSnapshot.headHash,
    isDetachedHead: nextSnapshot.isDetachedHead,
    ahead: nextSnapshot.ahead,
    behind: nextSnapshot.behind,
    files: nextSnapshot.files,
    branches: nextSnapshot.branches,
    remotes: nextSnapshot.remotes,
    remoteBranches: nextSnapshot.remoteBranches,
    upstream: nextSnapshot.upstream,
    base: nextSnapshot.base,
    mergeInProgress: nextSnapshot.mergeInProgress,
    mergeCommitMessage: nextSnapshot.mergeCommitMessage,
    repositoryPath: nextSnapshot.repositoryPath,
    lastRefreshedAt: nextSnapshot.lastRefreshedAt,
    statusText: nextSnapshot.statusText,
  });
  return currentSnapshot;
}

export function mergeGitWorkingTreeSnapshot(
  currentSnapshot: ProjectGitSnapshot | null | undefined,
  workingTreeSnapshot: ProjectBridgeGitWorkingTreeSnapshot,
): ProjectGitSnapshot | null {
  if (!currentSnapshot) return null;

  const statusText = workingTreeSnapshot.statusText || currentSnapshot.statusText || "OK";
  const detachedHeadPrefix =
    currentSnapshot.isDetachedHead && currentSnapshot.headHash && !statusText.startsWith("detached HEAD @")
      ? `detached HEAD @ ${currentSnapshot.headHash} · `
      : "";

  currentSnapshot.files = workingTreeSnapshot.files;
  currentSnapshot.repositoryPath = workingTreeSnapshot.repositoryPath || currentSnapshot.repositoryPath || "";
  currentSnapshot.lastRefreshedAt = workingTreeSnapshot.lastRefreshedAt || currentSnapshot.lastRefreshedAt;
  currentSnapshot.statusText = `${detachedHeadPrefix}${statusText}`;
  return currentSnapshot;
}

export function mergeGitCommitPage(currentSnapshot: ProjectGitSnapshot, commitPage: ProjectGitCommitPage): ProjectGitSnapshot {
  return {
    ...currentSnapshot,
    commits: [...currentSnapshot.commits, ...(commitPage.commits || [])],
    commitCount: normalizeGitCommitCount(commitPage.commitCount, currentSnapshot.commitCount),
    hasMoreCommits: commitPage.hasMoreCommits || false,
    nextCommitSkip: normalizeGitCommitSkip(
      commitPage.nextCommitSkip,
      currentSnapshot.nextCommitSkip ?? currentSnapshot.commits.length,
    ),
    repositoryPath: commitPage.repositoryPath || currentSnapshot.repositoryPath,
    lastRefreshedAt: commitPage.lastRefreshedAt || currentSnapshot.lastRefreshedAt,
  };
}

export function replaceGitCommitPage(
  currentSnapshot: ProjectGitSnapshot,
  commitPage: ProjectGitCommitPage,
): ProjectGitSnapshot {
  return {
    ...currentSnapshot,
    commits: commitPage.commits || [],
    commitCount: normalizeGitCommitCount(commitPage.commitCount, currentSnapshot.commitCount),
    hasMoreCommits: commitPage.hasMoreCommits || false,
    nextCommitSkip: normalizeGitCommitSkip(
      commitPage.nextCommitSkip,
      currentSnapshot.nextCommitSkip ?? currentSnapshot.commits.length,
    ),
    repositoryPath: commitPage.repositoryPath || currentSnapshot.repositoryPath,
    lastRefreshedAt: commitPage.lastRefreshedAt || currentSnapshot.lastRefreshedAt,
  };
}
