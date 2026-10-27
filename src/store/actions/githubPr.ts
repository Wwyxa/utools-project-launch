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

/**
 * GitHub PR 相关的桥接动作。状态（加载中/错误草稿）留在弹窗组件本地，
 * 这里只负责解析仓库上下文、调用桥接并拒绝过期结果。
 */
export const githubPrActions = {
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
