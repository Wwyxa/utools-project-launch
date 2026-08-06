import { describe, expect, it } from "vitest";
import type { ProjectGitRemoteSummary } from "../src/types";
import { getGitHubCommitUrl } from "../src/lib/gitHubCommitUrl";

const remote = (name: string, fetchUrl: string): ProjectGitRemoteSummary => ({ name, fetchUrl, pushUrl: "" });

describe("getGitHubCommitUrl", () => {
  it("builds a commit URL from HTTPS and SSH GitHub remotes", () => {
    expect(getGitHubCommitUrl([remote("origin", "https://github.com/owner/repository.git")], "abc123")).toBe(
      "https://github.com/owner/repository/commit/abc123",
    );
    expect(getGitHubCommitUrl([remote("origin", "git@github.com:owner/repository.git")], "abc123")).toBe(
      "https://github.com/owner/repository/commit/abc123",
    );
  });

  it("uses origin, then upstream, then the first supported remote", () => {
    expect(
      getGitHubCommitUrl(
        [
          remote("fork", "https://github.com/fork/repository.git"),
          remote("upstream", "https://github.com/upstream/repository.git"),
          remote("origin", "https://github.com/origin/repository.git"),
        ],
        "abc123",
      ),
    ).toBe("https://github.com/origin/repository/commit/abc123");

    expect(
      getGitHubCommitUrl(
        [
          remote("fork", "https://github.com/fork/repository.git"),
          remote("upstream", "https://github.com/upstream/repository.git"),
        ],
        "abc123",
      ),
    ).toBe("https://github.com/upstream/repository/commit/abc123");

    expect(getGitHubCommitUrl([remote("fork", "https://github.com/fork/repository.git")], "abc123")).toBe(
      "https://github.com/fork/repository/commit/abc123",
    );
  });

  it("returns no URL when no supported GitHub remote exists", () => {
    expect(getGitHubCommitUrl([], "abc123")).toBeUndefined();
    expect(getGitHubCommitUrl([remote("origin", "https://gitlab.com/owner/repository.git")], "abc123")).toBeUndefined();
  });
});
