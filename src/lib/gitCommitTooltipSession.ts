import type { ProjectGitCommitShortStats, ProjectGitFileChange } from '../types';

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
const unavailableAvatars = new WeakSet<GitCommitTooltipSessionDetails>();
const prefetchedAvatars = new Map<string, Map<string, Promise<GitCommitTooltipAvatarDetails>>>();

export const prefetchGitCommitTooltipAvatar = (
  contextKey: string,
  hash: string,
  loader: () => Promise<string | null>,
): Promise<GitCommitTooltipAvatarDetails> => {
  let session = prefetchedAvatars.get(contextKey);
  if (!session) {
    session = new Map();
    prefetchedAvatars.set(contextKey, session);
  }
  const existing = session.get(hash);
  if (existing) return existing;
  const pending = readAvatar(loader);
  session.set(hash, pending);
  void pending.then(({ avatarUrl }) => {
    if (!avatarUrl && session.get(hash) === pending) session.delete(hash);
    if (!session.size && prefetchedAvatars.get(contextKey) === session) prefetchedAvatars.delete(contextKey);
  });
  while ([...prefetchedAvatars.values()].reduce((total, entries) => total + entries.size, 0) > GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES) {
    const oldestContext = prefetchedAvatars.entries().next().value;
    if (!oldestContext) break;
    const [oldestKey, hashes] = oldestContext;
    const oldestHash = hashes.keys().next().value;
    if (oldestHash !== undefined) hashes.delete(oldestHash);
    if (!hashes.size) prefetchedAvatars.delete(oldestKey);
  }
  return pending;
};

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

const trackAvatarResult = (details: GitCommitTooltipSessionDetails) => {
  const pending = details.avatar;
  unavailableAvatars.delete(details);
  void pending.then(({ avatarUrl }) => {
    if (details.avatar === pending && !avatarUrl) unavailableAvatars.add(details);
  });
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
    if (unavailableAvatars.has(existing) && loaders.loadAvatar) {
      existing.avatar = readAvatar(loaders.loadAvatar);
      trackAvatarResult(existing);
    }
    return existing;
  }

  const details: GitCommitTooltipSessionDetails = {
    files: readFiles(hasUsableGitCommitShortStats(loaders.preloadedShortStats) ? undefined : loaders.loadFiles),
    avatar: prefetchedAvatars.get(contextKey)?.get(hash) ?? readAvatar(loaders.loadAvatar),
  };
  trackAvatarResult(details);
  session.set(hash, details);
  pruneToCapacity();
  return details;
};

export const pruneGitCommitTooltipSession = (contextKey: string, availableHashes: Set<string>) => {
  const prefetched = prefetchedAvatars.get(contextKey);
  if (prefetched) {
    for (const hash of prefetched.keys()) {
      if (!availableHashes.has(hash)) prefetched.delete(hash);
    }
    if (!prefetched.size) prefetchedAvatars.delete(contextKey);
  }
  const session = sessions.get(contextKey);
  if (!session) return;

  for (const hash of session.keys()) {
    if (!availableHashes.has(hash)) session.delete(hash);
  }
  if (session.size === 0) sessions.delete(contextKey);
};

export const clearGitCommitTooltipSessionsForProject = (projectId: string) => {
  const contextPrefix = `${projectId}::`;
  for (const contextKey of prefetchedAvatars.keys()) {
    if (contextKey.startsWith(contextPrefix)) prefetchedAvatars.delete(contextKey);
  }
  for (const contextKey of sessions.keys()) {
    if (contextKey.startsWith(contextPrefix)) sessions.delete(contextKey);
  }
};

export const markGitCommitTooltipSessionAvatarUnavailable = (contextKey: string, hash: string) => {
  prefetchedAvatars.get(contextKey)?.delete(hash);
  const details = sessions.get(contextKey)?.get(hash);
  if (details) {
    details.avatar = Promise.resolve({ avatarUrl: null });
    unavailableAvatars.add(details);
  }
};
