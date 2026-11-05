import type {
  GithubApiResult,
  GithubPrContext,
  GithubPrCreateInput,
  GithubPrUpdateInput,
  GithubPullRequestSummary,
  GithubRepositoryMetadata,
  ProjectGitReadResult,
  ProjectGitRepositoryTarget,
} from "../../types";
import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import { createGithubPrSession, type GithubPrSession } from "../helpers/githubPrSession";

/** GitHub PR 桥接动作与当前应用运行期间的创建会话。 */
export const githubPrActions = {
    githubPrSession(
      this: AppStore,
      projectId: string,
      target: ProjectGitRepositoryTarget = { kind: "main" },
    ): GithubPrSession {
      const context = this.resolveGitRepositoryContext(projectId, target);
      const branch = this.gitSnapshotForRepository(projectId, target)?.branch || "";
      if (!context || !branch) return createGithubPrSession(this, projectId, target, branch);
      const key = JSON.stringify([context.contextKey, branch]);
      return this.githubPrSessions[key] ??= createGithubPrSession(this, projectId, context.target, branch);
    },

    clearGithubPrSessions(this: AppStore, projectId: string) {
      for (const [key, session] of Object.entries(this.githubPrSessions)) {
        if (session.projectId !== projectId) continue;
        session.dispose();
        delete this.githubPrSessions[key];
      }
    },
    async readGithubRepositoryMetadata(
      this: AppStore,
      owner: string,
      repository: string,
    ): Promise<GithubApiResult<GithubRepositoryMetadata>> {
      return bridge.readGithubRepositoryMetadata(owner, repository);
    },

    async readGithubPullRequestTemplates(
      this: AppStore,
      owner: string,
      repository: string,
    ): Promise<GithubApiResult<string[]>> {
      return bridge.readGithubPullRequestTemplates(owner, repository);
    },

    async readGithubOpenPullRequest(
      this: AppStore,
      owner: string,
      repository: string,
      headOwner: string,
      branch: string,
    ): Promise<GithubApiResult<GithubPullRequestSummary | null>> {
      return bridge.readGithubOpenPullRequest(owner, repository, headOwner, branch);
    },

    async createGithubPullRequest(this: AppStore, input: GithubPrCreateInput) {
      return bridge.createGithubPullRequest(input);
    },

    async updateGithubPullRequest(this: AppStore, input: GithubPrUpdateInput) {
      return bridge.updateGithubPullRequest(input);
    },

    async openExternalUrl(this: AppStore, url: string) {
      const target = String(url || "").trim();
      if (/^https?:\/\//i.test(target)) {
        await bridge.openPath(target);
      }
    },

    async readGithubPrContext(
      this: AppStore,
      projectId: string,
      target: ProjectGitRepositoryTarget = { kind: "main" },
      options: { baseRemote: string; baseBranch: string; headBranch: string },
    ): Promise<ProjectGitReadResult<GithubPrContext> | null> {
      const context = this.resolveGitRepositoryContext(projectId, target);
      if (!context) return null;
      const result = await bridge.readGithubPrContext(context.repositoryPath, options);
      return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
        ? result
        : null;
    },
};
