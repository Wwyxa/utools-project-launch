import type { ProjectGitCommitShortStats, ProjectGitFileChange } from "../types";

export const GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES = 120;

export type GitCommitTooltipFileDetails = {
  files: ProjectGitFileChange[] | null;
  unavailable: boolean;
};

export type GitCommitTooltipAvatarDetails = {
  avatarUrl: string | null;
};

export type GitCommitTooltipSessionLoaders = {
  preloadedShortStats?: ProjectGitCommitShortStats;
  loadFiles?: () => Promise<ProjectGitFileChange[]>;
  loadAvatar?: () => Promise<string | null>;
};

export type GitCommitTooltipSessionDetails = {
  files: Promise<GitCommitTooltipFileDetails>;
  avatar: Promise<GitCommitTooltipAvatarDetails>;
};

const sessions = new Map<string, Map<string, GitCommitTooltipSessionDetails>>();

export const hasUsableGitCommitShortStats = (
  shortStats: ProjectGitCommitShortStats | undefined,
): shortStats is ProjectGitCommitShortStats =>
  Boolean(
    shortStats &&
    Number.isSafeInteger(shortStats.files) &&
    shortStats.files >= 0 &&
    Number.isSafeInteger(shortStats.additions) &&
    shortStats.additions >= 0 &&
    Number.isSafeInteger(shortStats.deletions) &&
    shortStats.deletions >= 0,
  );

const unavailableFiles = (): GitCommitTooltipFileDetails => ({ files: null, unavailable: true });

const readFiles = async (loader?: () => Promise<ProjectGitFileChange[]>): Promise<GitCommitTooltipFileDetails> => {
  if (!loader) return unavailableFiles();
  try {
    return { files: await loader(), unavailable: false };
  } catch {
    return unavailableFiles();
  }
};

const readAvatar = async (loader?: () => Promise<string | null>): Promise<GitCommitTooltipAvatarDetails> => {
  if (!loader) return { avatarUrl: null };
  try {
    return { avatarUrl: await loader() };
  } catch {
    return { avatarUrl: null };
  }
};

const retainedHashCount = () => {
  let count = 0;
  for (const hashes of sessions.values()) count += hashes.size;
  return count;
};

const pruneToCapacity = () => {
  while (retainedHashCount() > GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES) {
    for (const [contextKey, hashes] of sessions) {
      const oldestHash = hashes.keys().next();
      if (!oldestHash.done) hashes.delete(oldestHash.value);
      if (hashes.size === 0) sessions.delete(contextKey);
      break;
    }
  }
};

const sessionFor = (contextKey: string) => {
  const existing = sessions.get(contextKey);
  if (existing) {
    sessions.delete(contextKey);
    sessions.set(contextKey, existing);
    return existing;
  }

  const session = new Map<string, GitCommitTooltipSessionDetails>();
  sessions.set(contextKey, session);
  return session;
};

export const loadGitCommitTooltipSessionDetails = (
  contextKey: string,
  hash: string,
  loaders: GitCommitTooltipSessionLoaders,
): GitCommitTooltipSessionDetails => {
  const session = sessionFor(contextKey);
  const existing = session.get(hash);
  if (existing) {
    session.delete(hash);
    session.set(hash, existing);
    return existing;
  }

  const details: GitCommitTooltipSessionDetails = {
    files: readFiles(hasUsableGitCommitShortStats(loaders.preloadedShortStats) ? undefined : loaders.loadFiles),
    avatar: readAvatar(loaders.loadAvatar),
  };
  session.set(hash, details);
  pruneToCapacity();
  return details;
};

export const pruneGitCommitTooltipSession = (contextKey: string, availableHashes: Set<string>) => {
  const session = sessions.get(contextKey);
  if (!session) return;

  for (const hash of session.keys()) {
    if (!availableHashes.has(hash)) session.delete(hash);
  }
  if (session.size === 0) sessions.delete(contextKey);
};

export const clearGitCommitTooltipSessionsForProject = (projectId: string) => {
  const contextPrefix = `${projectId}::`;
  for (const contextKey of sessions.keys()) {
    if (contextKey.startsWith(contextPrefix)) sessions.delete(contextKey);
  }
};

export const markGitCommitTooltipSessionAvatarUnavailable = (contextKey: string, hash: string) => {
  const details = sessions.get(contextKey)?.get(hash);
  if (details) details.avatar = Promise.resolve({ avatarUrl: null });
};
