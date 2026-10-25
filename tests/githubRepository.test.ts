import { describe, expect, it } from "vitest";
import {
  listGithubRemotes,
  orderGithubBaseRemotes,
  resolveDefaultGithubHeadRemote,
} from "../src/lib/githubRepository";
import type { ProjectGitRemoteSummary } from "../src/types";

const remote = (name: string, fetchUrl: string): ProjectGitRemoteSummary => ({
  name,
  fetchUrl,
  pushUrl: fetchUrl,
});

describe("githubRepository", () => {
  it("only collects GitHub remotes, keeping distinct names that resolve to the same repository", () => {
    const remotes = [
      remote("gitlab", "https://gitlab.com/a/b.git"),
      remote("origin", "https://github.com/wyxa/app.git"),
      remote("second", "git@github.com:Wyxa/App.git"),
    ];
    expect(listGithubRemotes(remotes)).toEqual([
      { remoteName: "origin", owner: "wyxa", repository: "app" },
      { remoteName: "second", owner: "Wyxa", repository: "App" },
    ]);
  });

  it("orders base candidates upstream → origin → rest", () => {
    const remotes = [
      remote("fork", "https://github.com/wyxa/app.git"),
      remote("origin", "https://github.com/wyxa/app.git"),
      remote("upstream", "https://github.com/base/app.git"),
    ];
    expect(orderGithubBaseRemotes(remotes).map((item) => item.remoteName)).toEqual(["upstream", "origin", "fork"]);
  });

  it("prefers the branch upstream remote for the head repository", () => {
    const remotes = [
      remote("upstream", "https://github.com/base/app.git"),
      remote("origin", "https://github.com/wyxa/app.git"),
    ];
    const upstream = { remote: "origin", branch: "feat", ref: "origin/feat", ahead: 1, behind: 0 };
    expect(resolveDefaultGithubHeadRemote(remotes, upstream)?.remoteName).toBe("origin");
    expect(resolveDefaultGithubHeadRemote(remotes, null)?.remoteName).toBe("origin");
  });
});
