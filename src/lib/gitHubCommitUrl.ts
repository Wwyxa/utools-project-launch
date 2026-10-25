import { parseGitHubRepository } from "./githubRepository";
import type { ProjectGitRemoteSummary } from "../types";

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
