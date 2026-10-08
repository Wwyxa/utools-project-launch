import type { AppStore } from "../appStoreShape";
import type { ProjectGitActionResult, ProjectGitRepositoryTarget, ProjectGitRepositoryContext, ProjectGitStashOptions, ProjectGitPushOptions, ProjectGitMergeResult } from "../../types";
import { queueGitWriteLock, clearGitRepositoryCoordination, bumpGitRefMutationVersion, clearGitRepositoryRecord, gitWorkspaceRefreshPromises, gitWorkspaceRefreshTokens, bumpGitMutationVersion } from "../helpers/gitHelpers";
import { createGitRepositoryContextKey } from "../../lib/gitRepositoryTarget";
import { bridge } from "../helpers/bridge";

export const gitMutationsActions = {
  async initializeGitRepository(this: AppStore, projectId: string): Promise<ProjectGitActionResult | null> {
    const initialProject = this.projects.find((item) => item.id === projectId);
    if (!initialProject || initialProject.pathExists === false) return null;

    const projectPath = initialProject.path;
    const initialGitSnapshot = initialProject.git;
    const writeLock = queueGitWriteLock(createGitRepositoryContextKey(projectId, { kind: "main" }, projectPath));
    await writeLock.waitForPrevious;
    const project = this.projects.find((item) => item.id === projectId);
    if (
      !project ||
      project.path !== projectPath ||
      project.pathExists === false ||
      project.git !== initialGitSnapshot
    ) {
      writeLock.release();
      return null;
    }
    let projectPathExists = false;
    try {
      projectPathExists = await bridge.pathExists(projectPath);
    } catch (error) {
      writeLock.release();
      throw error;
    }
    if (!projectPathExists || this.projects.find((item) => item.id === projectId)?.path !== projectPath) {
      writeLock.release();
      return null;
    }

    this.gitWritesInProgress[projectId] = (this.gitWritesInProgress[projectId] || 0) + 1;
    try {
      const result = await bridge.initializeGitRepository(projectPath);
      if (this.projects.find((item) => item.id === projectId)?.path !== projectPath) return null;
      if (!result.ok) return result;

      this.workActivityUnavailableProjectIds = this.workActivityUnavailableProjectIds.filter(
        (unavailableProjectId) => unavailableProjectId !== projectId,
      );
      clearGitRepositoryCoordination(projectId, true);
      bumpGitRefMutationVersion(projectId);
      clearGitRepositoryRecord(this.gitRepositorySnapshots, projectId);
      clearGitRepositoryRecord(this.gitRepositoryRefreshing, projectId);
      clearGitRepositoryRecord(this.gitRepositoryStatusRefreshing, projectId);
      clearGitRepositoryRecord(this.gitRepositoryReadFailures, projectId);
      clearGitRepositoryRecord(this.gitRepositoryLoadingMore, projectId);
      gitWorkspaceRefreshPromises.delete(projectId);
      gitWorkspaceRefreshTokens.delete(projectId);
      delete this.gitWorkspaces[projectId];
      delete this.gitWorkspaceRefreshing[projectId];
      delete this.stagedFiles[projectId];

      const currentProject = this.projects.find((item) => item.id === projectId);
      if (currentProject) {
        currentProject.git = undefined;
        currentProject.gitLatestCommitAt = "";
      }

      await Promise.all([
        this.refreshGitWorkspace(projectId, { force: true }),
        this.refreshGitSnapshot(projectId, { force: true }, { kind: "main" }),
      ]);
      return result;
    } finally {
      this.gitWritesInProgress[projectId] = Math.max(0, (this.gitWritesInProgress[projectId] || 1) - 1);
      writeLock.release();
    }
  },

  async runAuthorizedGitWrite<TResult extends ProjectGitActionResult>(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget,
    action: (context: ProjectGitRepositoryContext) => Promise<TResult>,
    options: { refresh: "working-tree" | "status" | "full"; refs?: boolean; refreshOnFailure?: boolean },
  ): Promise<TResult | null> {
    const initialContext = this.resolveGitRepositoryContext(projectId, target);
    if (!initialContext) return null;

    const writeLock = queueGitWriteLock(initialContext.contextKey);
    await writeLock.waitForPrevious;
    let writeStarted = false;
    try {
      const context = this.resolveGitRepositoryContext(projectId, target);
      if (!context || context.contextKey !== initialContext.contextKey) return null;

      writeStarted = true;
      this.gitWritesInProgress[projectId] = (this.gitWritesInProgress[projectId] || 0) + 1;
      const result = await action(context);
      const changed = result.ok || (result.count || 0) > 0 || options.refreshOnFailure === true;
      if (!changed) return result;

      bumpGitMutationVersion(context.contextKey);
      if (options.refs) {
        bumpGitRefMutationVersion(projectId);
        const contextPrefix = `${projectId}::`;
        Object.keys(this.gitRepositorySnapshots).forEach((key) => {
          if (key.startsWith(contextPrefix) && key !== context.contextKey) {
            delete this.gitRepositorySnapshots[key];
          }
        });
      }

      const refreshes: Array<Promise<void> | undefined> = [
        options.refresh === "working-tree"
          ? this.refreshGitWorkingTreeSnapshot(projectId, context.target)
          : options.refresh === "status"
            ? this.refreshGitStatusSnapshot(projectId, context.target)
            : this.refreshGitSnapshot(projectId, { force: true }, context.target),
      ];
      if (options.refresh === "working-tree") {
        void this.refreshGitWorkspace(projectId, { force: true });
      } else {
        refreshes.push(this.refreshGitWorkspace(projectId, { force: true }));
      }
      if (options.refs && context.target.kind !== "main") {
        refreshes.push(this.refreshGitSnapshot(projectId, { force: true }, { kind: "main" }));
      }
      await Promise.all(refreshes);
      return result;
    } finally {
      if (writeStarted) {
        this.gitWritesInProgress[projectId] = Math.max(0, (this.gitWritesInProgress[projectId] || 1) - 1);
      }
      writeLock.release();
    }
  },

  async stageGitFile(this: AppStore,
    projectId: string,
    relativePath: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.stageGitFile(context.repositoryPath, relativePath),
      { refresh: "working-tree" },
    );
  },

  async unstageGitFile(this: AppStore,
    projectId: string,
    relativePath: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.unstageGitFile(context.repositoryPath, relativePath),
      { refresh: "working-tree" },
    );
  },

  async discardGitFile(this: AppStore,
    projectId: string,
    relativePath: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.discardGitFile(context.repositoryPath, relativePath),
      { refresh: "working-tree", refreshOnFailure: true },
    );
  },

  async stageGitFiles(this: AppStore,
    projectId: string,
    relativePaths: string[],
    options: { all?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.stageGitFiles(context.repositoryPath, relativePaths, options),
      { refresh: "working-tree", refreshOnFailure: true },
    );
  },

  async unstageGitFiles(this: AppStore,
    projectId: string,
    relativePaths: string[],
    options: { all?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.unstageGitFiles(context.repositoryPath, relativePaths, options),
      { refresh: "working-tree", refreshOnFailure: true },
    );
  },

  async discardGitFiles(this: AppStore,
    projectId: string,
    relativePaths: string[],
    options: { all?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.discardGitFiles(context.repositoryPath, relativePaths, options),
      { refresh: "working-tree", refreshOnFailure: true },
    );
  },

  async commitGitStaged(this: AppStore,
    projectId: string,
    message: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.commitGitStaged(context.repositoryPath, message),
      { refresh: "full", refs: true },
    );
  },

  async amendGitCommit(this: AppStore,
    projectId: string,
    message: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.amendGitCommit(context.repositoryPath, message),
      { refresh: "full", refs: true },
    );
  },

  async undoLastGitCommit(this: AppStore,
    projectId: string,
    options: { allowMerge?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.undoLastGitCommit(context.repositoryPath, options),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async cherryPickGitCommit(this: AppStore,
    projectId: string,
    commitHash: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.cherryPickGitCommit(context.repositoryPath, commitHash),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async revertGitCommit(this: AppStore,
    projectId: string,
    commitHash: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.revertGitCommit(context.repositoryPath, commitHash),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async createGitStash(this: AppStore,
    projectId: string,
    message = "",
    options: ProjectGitStashOptions = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.createGitStash(context.repositoryPath, message, options),
      { refresh: "full", refs: true },
    );
  },

  async applyGitStash(this: AppStore,
    projectId: string,
    stashRef: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.applyGitStash(context.repositoryPath, stashRef),
      { refresh: "full", refreshOnFailure: true },
    );
  },

  async popGitStash(this: AppStore,
    projectId: string,
    stashRef: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.popGitStash(context.repositoryPath, stashRef),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async dropGitStash(this: AppStore,
    projectId: string,
    stashRef: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.dropGitStash(context.repositoryPath, stashRef),
      { refresh: "full", refs: true },
    );
  },

  async switchGitBranch(this: AppStore,
    projectId: string,
    branchName: string,
    options: { force?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.switchGitBranch(context.repositoryPath, branchName, options),
      { refresh: "full", refs: true },
    );
  },

  async checkoutGitCommit(this: AppStore,
    projectId: string,
    commitHash: string,
    options: { force?: boolean; detach?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) =>
        bridge.checkoutGitCommit(context.repositoryPath, commitHash, {
          ...options,
          preferredBranch: this.gitSnapshotForRepository(projectId, context.target)?.branch,
        }),
      { refresh: "full", refs: true },
    );
  },

  async createGitBranch(this: AppStore,
    projectId: string,
    branchName: string,
    commitHash: string,
    options: { checkout?: boolean; force?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.createGitBranch(context.repositoryPath, branchName, commitHash, options),
      { refresh: "full", refs: true },
    );
  },

  async createGitTag(this: AppStore,
    projectId: string,
    tagName: string,
    commitHash: string,
    options: { annotated?: boolean; message?: string } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.createGitTag(context.repositoryPath, tagName, commitHash, options),
      { refresh: "full", refs: true },
    );
  },

  async deleteGitTag(this: AppStore,
    projectId: string,
    tagName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.deleteGitTag(context.repositoryPath, tagName),
      { refresh: "full", refs: true },
    );
  },

  async pushGitTag(this: AppStore,
    projectId: string,
    tagName: string,
    remoteName = "",
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.pushGitTag(context.repositoryPath, tagName, remoteName),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async renameGitBranch(this: AppStore,
    projectId: string,
    branchName: string,
    nextBranchName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.renameGitBranch(context.repositoryPath, branchName, nextBranchName),
      { refresh: "full", refs: true },
    );
  },

  async deleteGitBranch(this: AppStore,
    projectId: string,
    branchName: string,
    options: { force?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.deleteGitBranch(context.repositoryPath, branchName, options),
      { refresh: "full", refs: true },
    );
  },

  async checkoutGitRemoteBranch(this: AppStore,
    projectId: string,
    remoteRef: string,
    options: { force?: boolean } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.checkoutGitRemoteBranch(context.repositoryPath, remoteRef, options),
      { refresh: "full", refs: true },
    );
  },

  async fetchGitRemote(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(projectId, target, (context) => bridge.fetchGitRemote(context.repositoryPath), {
      refresh: "full",
      refs: true,
      refreshOnFailure: true,
    });
  },

  async fetchGitRemoteByName(this: AppStore,
    projectId: string,
    remoteName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.fetchGitRemoteByName(context.repositoryPath, remoteName),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async pullGitRemote(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(projectId, target, (context) => bridge.pullGitRemote(context.repositoryPath), {
      refresh: "full",
      refs: true,
      refreshOnFailure: true,
    });
  },

  async pushGitRemote(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
    options: ProjectGitPushOptions = {},
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.pushGitRemote(context.repositoryPath, options),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async mergeGitBaseBranch(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitMergeResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.mergeGitBaseBranch(context.repositoryPath),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async abortGitMerge(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(projectId, target, (context) => bridge.abortGitMerge(context.repositoryPath), {
      refresh: "full",
      refreshOnFailure: true,
    });
  },

  async publishGitBranch(this: AppStore,
    projectId: string,
    remoteName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.publishGitBranch(context.repositoryPath, remoteName),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async addGitRemote(this: AppStore,
    projectId: string,
    remoteName: string,
    remoteUrl: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.addGitRemote(context.repositoryPath, remoteName, remoteUrl),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async setGitRemoteUrl(this: AppStore,
    projectId: string,
    remoteName: string,
    remoteUrl: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.setGitRemoteUrl(context.repositoryPath, remoteName, remoteUrl),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async removeGitRemote(this: AppStore,
    projectId: string,
    remoteName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.removeGitRemote(context.repositoryPath, remoteName),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  },

  async deleteGitRemoteBranch(this: AppStore,
    projectId: string,
    remoteName: string,
    branchName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitActionResult | null> {
    return this.runAuthorizedGitWrite(
      projectId,
      target,
      (context) => bridge.deleteGitRemoteBranch(context.repositoryPath, remoteName, branchName),
      { refresh: "full", refs: true, refreshOnFailure: true },
    );
  }
};
