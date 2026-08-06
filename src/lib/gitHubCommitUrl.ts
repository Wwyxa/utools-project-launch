import type { ProjectGitRemoteSummary } from "../types";

type GitHubRepository = { owner: string; repository: string };

const parseGitHubRepository = (remoteUrl: string): GitHubRepository | undefined => {
  const value = remoteUrl.trim();
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(value) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(value);

  return match ? { owner: match[1], repository: match[2] } : undefined;
};

const orderedRemotes = (remotes: readonly ProjectGitRemoteSummary[]) => {
  const preferred = ["origin", "upstream"]
    .map((name) => remotes.find((remote) => remote.name === name))
    .filter((remote): remote is ProjectGitRemoteSummary => Boolean(remote));

  return [...preferred, ...remotes.filter((remote) => !preferred.includes(remote))];
};

export const getGitHubCommitUrl = (
  remotes: readonly ProjectGitRemoteSummary[],
  commitHash: string,
): string | undefined => {
  const hash = commitHash.trim();
  if (!hash) return undefined;

  for (const remote of orderedRemotes(remotes)) {
    const repository = parseGitHubRepository(remote.fetchUrl);
    if (repository) {
      return `https://github.com/${repository.owner}/${repository.repository}/commit/${encodeURIComponent(hash)}`;
    }
  }

  return undefined;
};
