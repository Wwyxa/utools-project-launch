import type { AppStore } from "../appStoreShape";
import type { ProjectGitRepositoryTarget, ProjectGitRepositoryContext, ProjectGitSnapshot, ProjectGitFileDiffOptions, ProjectGitFileDiffResult, ProjectGitStash, ProjectGitFileChange, ProjectGitTagInfo, ProjectGitCommitMessageDiffResult } from "../../types";
import { resolveProjectGitRepositoryContext } from "../../lib/gitRepositoryTarget";
import { isCompleteGitSnapshot, gitSnapshotRefreshPromises, gitLoadMorePromises, gitLoadMoreTokens, gitSnapshotRefreshTokens, gitMutationVersion, gitRefMutationVersion, setGitReadFailure, createGitReadFailureFromError, bumpGitRefMutationVersion, clearGitSnapshotForRepository, clearGitReadFailure, normalizeGitSnapshot, replaceGitCommitPage, mergeGitSnapshotPreservingHistory, gitStatusRefreshPromises, gitWorkingTreeRefreshPromises, gitWorkspaceRefreshPromises, gitWorkspaceRefreshTokens, gitWorkingTreeRefreshTokens, mergeGitWorkingTreeSnapshot, gitStatusRefreshTokens, mergeGitStatusSnapshot, gitHistorySnapshotSignature, mergeGitCommitPage } from "../helpers/gitHelpers";
import { bridge } from "../helpers/bridge";
import { createLogEntry } from "../helpers/automationHelpers";

export const gitSnapshotActions = {
  resolveGitRepositoryContext(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): ProjectGitRepositoryContext | null {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return null;
    return resolveProjectGitRepositoryContext(project.id, project.path, this.gitWorkspaces[projectId], target);
  },

  gitSnapshotForRepository(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): ProjectGitSnapshot | null {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const project = this.projects.find((item) => item.id === projectId);
    const snapshot =
      context.target.kind === "main" ? project?.git || null : this.gitRepositorySnapshots[context.contextKey] || null;
    return isCompleteGitSnapshot(snapshot) ? snapshot : null;
  },

  async refreshGitSnapshot(this: AppStore,
    projectId: string,
    options: { force?: boolean; maxAgeMs?: number; limit?: number } = {},
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return;

    const existingRefresh = gitSnapshotRefreshPromises.get(context.contextKey);
    if (existingRefresh && !options.force) {
      return existingRefresh;
    }

    const currentSnapshot = this.gitSnapshotForRepository(projectId, target);
    const refreshedAt = Date.parse(currentSnapshot?.lastRefreshedAt || "");
    const snapshotAgeMs = Date.now() - refreshedAt;
    if (
      !options.force &&
      typeof options.maxAgeMs === "number" &&
      options.maxAgeMs > 0 &&
      Number.isFinite(refreshedAt) &&
      snapshotAgeMs >= 0 &&
      snapshotAgeMs < options.maxAgeMs
    ) {
      return;
    }

    if (gitLoadMorePromises.has(context.contextKey)) {
      gitLoadMorePromises.delete(context.contextKey);
      gitLoadMoreTokens.delete(context.contextKey);
      this.gitRepositoryLoadingMore[context.contextKey] = false;
    }

    this.gitRepositoryRefreshing[context.contextKey] = true;
    this.gitRepositoryStatusRefreshing[context.contextKey] = true;
    if (context.target.kind === "main") {
      this.gitRefreshing[projectId] = true;
      this.gitStatusRefreshing[projectId] = true;
    }
    const refreshToken = Symbol(context.contextKey);
    gitSnapshotRefreshTokens.set(context.contextKey, refreshToken);
    const refreshPromise = (async () => {
      const startedAtVersion = gitMutationVersion(context.contextKey);
      const startedAtRefVersion = gitRefMutationVersion(projectId);
      const isCurrentRefresh = () => {
        const latestContext = this.resolveGitRepositoryContext(projectId, context.target);
        return (
          gitSnapshotRefreshTokens.get(context.contextKey) === refreshToken &&
          latestContext?.contextKey === context.contextKey &&
          startedAtRefVersion === gitRefMutationVersion(projectId)
        );
      };
      try {
        let snapshotResult: Awaited<ReturnType<typeof bridge.readGitSnapshotResult>>;
        try {
          snapshotResult = await bridge.readGitSnapshotResult(context.repositoryPath, {
            limit: options.limit ?? 80,
            skip: 0,
          });
        } catch (error) {
          if (!isCurrentRefresh()) return;
          setGitReadFailure(
            this.gitRepositoryReadFailures,
            context.contextKey,
            createGitReadFailureFromError("history", error, "读取 Git 提交历史失败"),
          );
          return;
        }
        if (snapshotResult.ok === false) {
          if (!isCurrentRefresh()) return;
          if (snapshotResult.failure.code === "not-a-repository") {
            bumpGitRefMutationVersion(projectId);
            if (
              !clearGitSnapshotForRepository(
                this.projects,
                this.stagedFiles,
                this.gitRepositorySnapshots,
                projectId,
                context,
              )
            )
              return;
            clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey);
          }
          setGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, snapshotResult.failure);
          if (snapshotResult.failure.code === "not-a-repository" && context.target.kind === "main") {
            await this.persistProjects();
          }
          return;
        }
        const snapshot = snapshotResult.value;
        if (!isCurrentRefresh()) return;

        const project = this.projects.find((item) => item.id === projectId);
        if (!project) return;
        const currentSnapshot = this.gitSnapshotForRepository(projectId, target);
        const normalizedSnapshot = normalizeGitSnapshot(snapshot);
        if (!normalizedSnapshot) {
          setGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, {
            code: "invalid-output",
            operation: "history",
            message: "Git 返回了不完整的仓库快照。",
          });
          return;
        }
        clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey);
        const assignSnapshot = (nextSnapshot: ProjectGitSnapshot | null) => {
          if (context.target.kind === "main") project.git = nextSnapshot;
          else this.gitRepositorySnapshots[context.contextKey] = nextSnapshot || undefined;
        };

        if (startedAtVersion !== gitMutationVersion(context.contextKey)) {
          if (currentSnapshot) {
            assignSnapshot(replaceGitCommitPage(currentSnapshot, normalizedSnapshot));
            if (context.target.kind === "main" && project.git) {
              project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
            }
          }
          return;
        }

        assignSnapshot(mergeGitSnapshotPreservingHistory(currentSnapshot, normalizedSnapshot));
        if (context.target.kind === "main" && project.git) {
          project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
          this.stagedFiles[projectId] = project.git.files;
          await this.persistProjects();
        }
      } finally {
        if (gitSnapshotRefreshTokens.get(context.contextKey) === refreshToken) {
          gitSnapshotRefreshPromises.delete(context.contextKey);
          gitSnapshotRefreshTokens.delete(context.contextKey);
          this.gitRepositoryRefreshing[context.contextKey] = false;
          this.gitRepositoryStatusRefreshing[context.contextKey] = Boolean(
            gitStatusRefreshPromises.get(context.contextKey) || gitWorkingTreeRefreshPromises.get(context.contextKey),
          );
          if (context.target.kind === "main") {
            this.gitRefreshing[projectId] = false;
            this.gitStatusRefreshing[projectId] = Boolean(
              gitStatusRefreshPromises.get(context.contextKey) ||
              gitWorkingTreeRefreshPromises.get(context.contextKey),
            );
          }
        }
      }
    })();
    gitSnapshotRefreshPromises.set(context.contextKey, refreshPromise);
    return refreshPromise;
  },

  async refreshGitWorkspace(this: AppStore, projectId: string, options: { force?: boolean } = {}) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return;
    }

    const existingRefresh = gitWorkspaceRefreshPromises.get(projectId);
    if (existingRefresh && !options.force) {
      return existingRefresh;
    }

    const projectPath = project.path;
    const refreshToken = Symbol(projectId);
    gitWorkspaceRefreshTokens.set(projectId, refreshToken);
    this.gitWorkspaceRefreshing[projectId] = true;
    const refreshPromise = (async () => {
      try {
        const snapshot = await bridge.readGitWorkspaceSnapshot(projectPath);
        const currentProject = this.projects.find((item) => item.id === projectId);
        if (gitWorkspaceRefreshTokens.get(projectId) === refreshToken && currentProject?.path === projectPath) {
          this.gitWorkspaces[projectId] = snapshot;
        }
      } catch (error) {
        if (gitWorkspaceRefreshTokens.get(projectId) === refreshToken) {
          this.addLog(
            projectId,
            createLogEntry(
              `Failed to refresh Git workspace: ${error instanceof Error ? error.message : String(error)}`,
              "WARN",
            ),
          );
        }
      } finally {
        if (gitWorkspaceRefreshTokens.get(projectId) === refreshToken) {
          gitWorkspaceRefreshPromises.delete(projectId);
          gitWorkspaceRefreshTokens.delete(projectId);
          this.gitWorkspaceRefreshing[projectId] = false;
        }
      }
    })();
    gitWorkspaceRefreshPromises.set(projectId, refreshPromise);
    return refreshPromise;
  },

  async refreshGitWorkingTreeSnapshot(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget = { kind: "main" }) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return;

    const existingRefresh = gitWorkingTreeRefreshPromises.get(context.contextKey);
    if (existingRefresh) return existingRefresh;

    this.gitRepositoryStatusRefreshing[context.contextKey] = true;
    if (context.target.kind === "main") this.gitStatusRefreshing[projectId] = true;
    const refreshToken = Symbol(context.contextKey);
    gitWorkingTreeRefreshTokens.set(context.contextKey, refreshToken);
    const refreshPromise = (async () => {
      try {
        let needsAnotherRead = true;
        while (needsAnotherRead) {
          const startedAtVersion = gitMutationVersion(context.contextKey);
          const startedAtRefVersion = gitRefMutationVersion(projectId);
          const isCurrentRequest = () => {
            const latestContext = this.resolveGitRepositoryContext(projectId, context.target);
            return (
              gitWorkingTreeRefreshTokens.get(context.contextKey) === refreshToken &&
              latestContext?.contextKey === context.contextKey
            );
          };
          let workingTreeResult: Awaited<ReturnType<typeof bridge.readGitWorkingTreeSnapshotResult>>;
          try {
            workingTreeResult = await bridge.readGitWorkingTreeSnapshotResult(context.repositoryPath);
          } catch (error) {
            if (!isCurrentRequest()) return;
            if (
              startedAtVersion !== gitMutationVersion(context.contextKey) ||
              startedAtRefVersion !== gitRefMutationVersion(projectId)
            ) {
              continue;
            }
            setGitReadFailure(
              this.gitRepositoryReadFailures,
              context.contextKey,
              createGitReadFailureFromError("status", error, "读取 Git 工作区失败"),
            );
            return;
          }
          if (!isCurrentRequest()) return;
          if (workingTreeResult.ok === false) {
            if (
              startedAtVersion !== gitMutationVersion(context.contextKey) ||
              startedAtRefVersion !== gitRefMutationVersion(projectId)
            ) {
              continue;
            }
            if (workingTreeResult.failure.code === "not-a-repository") {
              bumpGitRefMutationVersion(projectId);
              if (
                !clearGitSnapshotForRepository(
                  this.projects,
                  this.stagedFiles,
                  this.gitRepositorySnapshots,
                  projectId,
                  context,
                )
              )
                return;
              clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey);
            }
            setGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, workingTreeResult.failure);
            if (workingTreeResult.failure.code === "not-a-repository" && context.target.kind === "main") {
              await this.persistProjects();
            }
            return;
          }
          if (
            startedAtVersion !== gitMutationVersion(context.contextKey) ||
            startedAtRefVersion !== gitRefMutationVersion(projectId)
          ) {
            continue;
          }

          clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, "status");
          clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, "repository");
          const workingTreeSnapshot = workingTreeResult.value;
          const project = this.projects.find((item) => item.id === projectId);
          if (!project) return;
          const currentSnapshot = this.gitSnapshotForRepository(projectId, target);
          const nextSnapshot = mergeGitWorkingTreeSnapshot(currentSnapshot, workingTreeSnapshot);
          if (context.target.kind === "main") {
            if (nextSnapshot) project.git = nextSnapshot;
            this.stagedFiles[projectId] = workingTreeSnapshot.files;
          } else if (nextSnapshot) {
            this.gitRepositorySnapshots[context.contextKey] = nextSnapshot;
          }
          needsAnotherRead = false;
        }
      } finally {
        if (gitWorkingTreeRefreshTokens.get(context.contextKey) === refreshToken) {
          gitWorkingTreeRefreshPromises.delete(context.contextKey);
          gitWorkingTreeRefreshTokens.delete(context.contextKey);
          this.gitRepositoryStatusRefreshing[context.contextKey] = Boolean(
            gitSnapshotRefreshPromises.get(context.contextKey) || gitStatusRefreshPromises.get(context.contextKey),
          );
          if (context.target.kind === "main") {
            this.gitStatusRefreshing[projectId] = Boolean(
              gitSnapshotRefreshPromises.get(context.contextKey) || gitStatusRefreshPromises.get(context.contextKey),
            );
          }
        }
      }
    })();
    gitWorkingTreeRefreshPromises.set(context.contextKey, refreshPromise);
    return refreshPromise;
  },

  async refreshGitStatusSnapshot(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget = { kind: "main" }) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return;

    const existingRefresh = gitStatusRefreshPromises.get(context.contextKey);
    if (existingRefresh) {
      return existingRefresh;
    }

    this.gitRepositoryStatusRefreshing[context.contextKey] = true;
    if (context.target.kind === "main") this.gitStatusRefreshing[projectId] = true;
    const refreshToken = Symbol(context.contextKey);
    gitStatusRefreshTokens.set(context.contextKey, refreshToken);
    const refreshPromise = (async () => {
      try {
        let lastKnownSnapshot = this.gitSnapshotForRepository(projectId, target);
        let needsAnotherRead = true;
        while (needsAnotherRead) {
          const startedAtVersion = gitMutationVersion(context.contextKey);
          const startedAtRefVersion = gitRefMutationVersion(projectId);
          const isCurrentRequest = () => {
            const latestContext = this.resolveGitRepositoryContext(projectId, context.target);
            return (
              gitStatusRefreshTokens.get(context.contextKey) === refreshToken &&
              latestContext?.contextKey === context.contextKey
            );
          };
          let statusResult: Awaited<ReturnType<typeof bridge.readGitStatusSnapshotResult>>;
          try {
            statusResult = await bridge.readGitStatusSnapshotResult(context.repositoryPath);
          } catch (error) {
            if (!isCurrentRequest()) return;
            if (
              startedAtVersion !== gitMutationVersion(context.contextKey) ||
              startedAtRefVersion !== gitRefMutationVersion(projectId)
            ) {
              continue;
            }
            setGitReadFailure(
              this.gitRepositoryReadFailures,
              context.contextKey,
              createGitReadFailureFromError("status", error, "读取 Git 状态失败"),
            );
            return;
          }
          if (statusResult.ok === false) {
            if (!isCurrentRequest()) return;
            if (
              startedAtVersion !== gitMutationVersion(context.contextKey) ||
              startedAtRefVersion !== gitRefMutationVersion(projectId)
            ) {
              continue;
            }
            if (statusResult.failure.code === "not-a-repository") {
              bumpGitRefMutationVersion(projectId);
              if (
                !clearGitSnapshotForRepository(
                  this.projects,
                  this.stagedFiles,
                  this.gitRepositorySnapshots,
                  projectId,
                  context,
                )
              )
                return;
              lastKnownSnapshot = null;
              clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey);
            }
            setGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, statusResult.failure);
            if (statusResult.failure.code === "not-a-repository" && context.target.kind === "main") {
              await this.persistProjects();
            }
            return;
          }
          if (!isCurrentRequest()) return;
          if (
            startedAtVersion !== gitMutationVersion(context.contextKey) ||
            startedAtRefVersion !== gitRefMutationVersion(projectId)
          ) {
            continue;
          }
          clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, "status");
          clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, "repository");
          const statusSnapshot = statusResult.value;
          const project = this.projects.find((item) => item.id === projectId);
          if (!project) return;
          const currentSnapshot = this.gitSnapshotForRepository(projectId, target) || lastKnownSnapshot;
          const nextSnapshot = mergeGitStatusSnapshot(currentSnapshot, statusSnapshot);
          if (!nextSnapshot) {
            needsAnotherRead = false;
            continue;
          }
          lastKnownSnapshot = nextSnapshot;
          if (context.target.kind === "main") {
            project.git = nextSnapshot;
            this.stagedFiles[projectId] = nextSnapshot.files;
          } else {
            this.gitRepositorySnapshots[context.contextKey] = nextSnapshot;
          }
          needsAnotherRead = false;
        }
      } finally {
        if (gitStatusRefreshTokens.get(context.contextKey) === refreshToken) {
          gitStatusRefreshPromises.delete(context.contextKey);
          gitStatusRefreshTokens.delete(context.contextKey);
          this.gitRepositoryStatusRefreshing[context.contextKey] = Boolean(
            gitSnapshotRefreshPromises.get(context.contextKey) ||
            gitWorkingTreeRefreshPromises.get(context.contextKey),
          );
          if (context.target.kind === "main") {
            this.gitStatusRefreshing[projectId] = Boolean(
              gitSnapshotRefreshPromises.get(context.contextKey) ||
              gitWorkingTreeRefreshPromises.get(context.contextKey),
            );
          }
        }
      }
    })();
    gitStatusRefreshPromises.set(context.contextKey, refreshPromise);
    return refreshPromise;
  },

  async refreshGitSnapshotForInteraction(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
    options: { maxAgeMs?: number; limit?: number } = {},
  ) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return;

    const existingSnapshotRefresh = gitSnapshotRefreshPromises.get(context.contextKey);
    if (existingSnapshotRefresh) return existingSnapshotRefresh;

    const currentSnapshot = this.gitSnapshotForRepository(projectId, target);
    const readFailures = this.gitRepositoryReadFailures[context.contextKey];
    if (!currentSnapshot || readFailures?.history || readFailures?.repository) {
      await this.refreshGitSnapshot(projectId, { limit: options.limit }, target);
      return;
    }
    const refreshedAt = Date.parse(currentSnapshot?.lastRefreshedAt || "");
    const snapshotAgeMs = Date.now() - refreshedAt;
    if (
      currentSnapshot &&
      typeof options.maxAgeMs === "number" &&
      options.maxAgeMs > 0 &&
      Number.isFinite(refreshedAt) &&
      snapshotAgeMs >= 0 &&
      snapshotAgeMs < options.maxAgeMs
    ) {
      return;
    }

    const previousHistorySignature = gitHistorySnapshotSignature(currentSnapshot);
    await this.refreshGitStatusSnapshot(projectId, target);

    const nextSnapshot = this.gitSnapshotForRepository(projectId, target);
    if (!nextSnapshot || gitHistorySnapshotSignature(nextSnapshot) !== previousHistorySignature) {
      await this.refreshGitSnapshot(projectId, { limit: options.limit }, target);
    }
  },

  async loadMoreGitCommits(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget = { kind: "main" }): Promise<void> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return;
    const snapshotRefresh = gitSnapshotRefreshPromises.get(context.contextKey);
    if (snapshotRefresh) {
      await snapshotRefresh;
      return this.loadMoreGitCommits(projectId, target);
    }

    const currentSnapshot = this.gitSnapshotForRepository(projectId, target);
    if (!currentSnapshot) return;
    const existingLoad = gitLoadMorePromises.get(context.contextKey);
    if (existingLoad) return existingLoad;

    const skip = currentSnapshot.nextCommitSkip ?? currentSnapshot.commits.length;
    const startedAtRefVersion = gitRefMutationVersion(projectId);
    const loadToken = Symbol(context.contextKey);
    gitLoadMoreTokens.set(context.contextKey, loadToken);
    this.gitRepositoryLoadingMore[context.contextKey] = true;
    const loadPromise = (async () => {
      const isCurrentLoad = () => {
        const latestContext = this.resolveGitRepositoryContext(projectId, context.target);
        return (
          gitLoadMoreTokens.get(context.contextKey) === loadToken &&
          latestContext?.contextKey === context.contextKey &&
          startedAtRefVersion === gitRefMutationVersion(projectId)
        );
      };
      try {
        let commitPageResult: Awaited<ReturnType<typeof bridge.readGitCommitsResult>>;
        try {
          commitPageResult = await bridge.readGitCommitsResult(context.repositoryPath, { limit: 80, skip });
        } catch (error) {
          if (!isCurrentLoad()) return;
          setGitReadFailure(
            this.gitRepositoryReadFailures,
            context.contextKey,
            createGitReadFailureFromError("history", error, "读取 Git 提交历史失败"),
          );
          return;
        }
        if (commitPageResult.ok === false) {
          if (!isCurrentLoad()) return;
          if (commitPageResult.failure.code === "not-a-repository") {
            bumpGitRefMutationVersion(projectId);
            if (
              !clearGitSnapshotForRepository(
                this.projects,
                this.stagedFiles,
                this.gitRepositorySnapshots,
                projectId,
                context,
              )
            )
              return;
            clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey);
          }
          setGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, commitPageResult.failure);
          if (commitPageResult.failure.code === "not-a-repository" && context.target.kind === "main") {
            await this.persistProjects();
          }
          return;
        }
        if (!isCurrentLoad()) return;
        clearGitReadFailure(this.gitRepositoryReadFailures, context.contextKey, "history");
        const commitPage = commitPageResult.value;
        const latestSnapshot = this.gitSnapshotForRepository(projectId, context.target);
        if (!latestSnapshot || (latestSnapshot.nextCommitSkip ?? latestSnapshot.commits.length) !== skip) {
          return;
        }
        const nextSnapshot = mergeGitCommitPage(latestSnapshot, commitPage);
        const project = this.projects.find((item) => item.id === projectId);
        if (context.target.kind === "main" && project) project.git = nextSnapshot;
        else this.gitRepositorySnapshots[context.contextKey] = nextSnapshot;
      } finally {
        if (gitLoadMoreTokens.get(context.contextKey) === loadToken) {
          gitLoadMoreTokens.delete(context.contextKey);
          gitLoadMorePromises.delete(context.contextKey);
          this.gitRepositoryLoadingMore[context.contextKey] = false;
        }
      }
    })();
    gitLoadMorePromises.set(context.contextKey, loadPromise);
    return loadPromise;
  },

  async readGitFileDiff(this: AppStore,
    projectId: string,
    relativePath: string,
    options?: ProjectGitFileDiffOptions,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitFileDiffResult | null> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const result = await bridge.readGitFileDiff(context.repositoryPath, relativePath, options);
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : null;
  },

  async readGitCommitFileDiff(this: AppStore,
    projectId: string,
    commitHash: string,
    relativePath: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
    stash?: ProjectGitStash,
    options?: ProjectGitFileDiffOptions,
  ): Promise<ProjectGitFileDiffResult | null> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const result = await bridge.readGitCommitFileDiff(
      context.repositoryPath,
      commitHash,
      relativePath,
      stash,
      options,
    );
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : null;
  },

  async readGitCommitFiles(this: AppStore,
    projectId: string,
    commitHash: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
    stash?: ProjectGitStash,
  ): Promise<ProjectGitFileChange[]> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return [];
    const result = await bridge.readGitCommitFiles(context.repositoryPath, commitHash, stash);
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : [];
  },

  async readGitTagInfo(this: AppStore,
    projectId: string,
    tagName: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitTagInfo | null> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const result = await bridge.readGitTagInfo(context.repositoryPath, tagName);
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : null;
  },

  async readGitCommitAuthorAvatar(this: AppStore,
    projectId: string,
    commitHash: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<string | null> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const result = await bridge.readGitCommitAuthorAvatar(context.repositoryPath, commitHash);
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : null;
  },

  async readGitCommitMessageDiff(this: AppStore,
    projectId: string,
    target: ProjectGitRepositoryTarget = { kind: "main" },
  ): Promise<ProjectGitCommitMessageDiffResult | null> {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (!context) return null;
    const result = await bridge.readGitCommitMessageDiff(context.repositoryPath);
    return this.resolveGitRepositoryContext(projectId, context.target)?.contextKey === context.contextKey
      ? result
      : null;
  }
};
