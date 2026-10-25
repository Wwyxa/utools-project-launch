import type { ProjectGitRemoteSummary, ProjectGitUpstreamSummary } from "../types";

type GitHubRepository = { owner: string; repository: string };

export const parseGitHubRepository = (remoteUrl: string): GitHubRepository | undefined => {
  const value = remoteUrl.trim();
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(value) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(value);

  return match ? { owner: match[1], repository: match[2] } : undefined;
};

export interface GithubRemoteRepository {
  remoteName: string;
  owner: string;
  repository: string;
}

/** 解析全部 GitHub 远端，保持 remotes 顺序（同名去重）。 */
export const listGithubRemotes = (
  remotes: readonly ProjectGitRemoteSummary[],
): GithubRemoteRepository[] => {
  const seen = new Set<string>();
  const githubRemotes: GithubRemoteRepository[] = [];
  for (const remote of remotes) {
    if (seen.has(remote.name)) continue;
    const repository = parseGitHubRepository(remote.fetchUrl) ?? parseGitHubRepository(remote.pushUrl);
    if (!repository) continue;
    seen.add(remote.name);
    githubRemotes.push({ remoteName: remote.name, ...repository });
  }
  return githubRemotes;
};

/** PR base 仓库候选：upstream → origin → 其余，返回 GitHub 远端列表。 */
export const orderGithubBaseRemotes = (
  remotes: readonly ProjectGitRemoteSummary[],
): GithubRemoteRepository[] => {
  const githubRemotes = listGithubRemotes(remotes);
  const preferredNames = ["upstream", "origin"];
  const ordered: GithubRemoteRepository[] = [];
  for (const name of preferredNames) {
    const match = githubRemotes.find((remote) => remote.remoteName === name);
    if (match && !ordered.includes(match)) ordered.push(match);
  }
  for (const remote of githubRemotes) {
    if (!ordered.includes(remote)) ordered.push(remote);
  }
  return ordered;
};

/** PR 源分支所在仓库：分支 upstream 远端优先，其次 origin，最后第一个 GitHub 远端。 */
export const resolveDefaultGithubHeadRemote = (
  remotes: readonly ProjectGitRemoteSummary[],
  upstream: ProjectGitUpstreamSummary | null | undefined,
): GithubRemoteRepository | undefined => {
  const githubRemotes = listGithubRemotes(remotes);
  return (
    githubRemotes.find((remote) => remote.remoteName === upstream?.remote) ??
    githubRemotes.find((remote) => remote.remoteName === "origin") ??
    githubRemotes[0]
  );
};
