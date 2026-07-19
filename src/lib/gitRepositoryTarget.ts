import type { ProjectGitRepositoryContext, ProjectGitRepositoryTarget, ProjectGitWorkspaceSnapshot } from "../types";

const isWindowsRepositoryPath = (repositoryPath: string) =>
  /^[a-z]:[\\/]/i.test(repositoryPath) || /^(?:\\\\|\/\/)[^\\/]/.test(repositoryPath);

export const normalizeGitRepositoryPath = (repositoryPath: string) => {
  const slashNormalized = repositoryPath.replace(/\\/g, "/");
  const normalized =
    slashNormalized === "/" || /^[a-z]:\/$/i.test(slashNormalized)
      ? slashNormalized
      : slashNormalized.replace(/\/+$/, "");
  return isWindowsRepositoryPath(repositoryPath) ? normalized.toLocaleLowerCase("en-US") : normalized;
};

export const gitRepositoryPathsEqual = (left: string, right: string) =>
  normalizeGitRepositoryPath(left) === normalizeGitRepositoryPath(right);

export const gitRepositoryTargetsEqual = (left: ProjectGitRepositoryTarget, right: ProjectGitRepositoryTarget) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "main" || right.kind === "main") return true;
  return gitRepositoryPathsEqual(left.path, right.path);
};

export const createGitRepositoryContextKey = (
  projectId: string,
  target: ProjectGitRepositoryTarget,
  repositoryPath: string,
) => `${projectId}::${target.kind}::${normalizeGitRepositoryPath(repositoryPath)}`;

export const resolveProjectGitRepositoryContext = (
  projectId: string,
  projectPath: string,
  snapshot: ProjectGitWorkspaceSnapshot | undefined,
  target: ProjectGitRepositoryTarget,
): ProjectGitRepositoryContext | null => {
  if (!projectId || !projectPath) return null;

  if (target.kind === "main") {
    const mainWorktree = snapshot?.worktrees.entries.find(
      (candidate) => candidate.kind === "main" || candidate.kind === "bare",
    );
    if (
      snapshot &&
      (!snapshot.repositoryPath ||
        (mainWorktree &&
          (mainWorktree.kind === "bare" ||
            !mainWorktree.pathAvailable ||
            mainWorktree.prunable ||
            mainWorktree.failure !== null)))
    ) {
      return null;
    }
    const repositoryPath = snapshot?.repositoryPath || projectPath;
    return {
      target: { kind: "main" },
      repositoryPath,
      contextKey: createGitRepositoryContextKey(projectId, target, repositoryPath),
    };
  }

  if (!snapshot) return null;

  if (target.kind === "worktree") {
    const worktree = snapshot.worktrees.entries.find(
      (candidate) =>
        candidate.kind === "linked" &&
        candidate.pathAvailable &&
        !candidate.prunable &&
        candidate.failure === null &&
        gitRepositoryPathsEqual(candidate.path, target.path),
    );
    if (!worktree) return null;
    const authorizedTarget: ProjectGitRepositoryTarget = { kind: "worktree", path: worktree.path };
    return {
      target: authorizedTarget,
      repositoryPath: worktree.path,
      contextKey: createGitRepositoryContextKey(projectId, authorizedTarget, worktree.path),
    };
  }

  const submodule = snapshot.submodules.entries.find(
    (candidate) =>
      candidate.pathAvailable &&
      candidate.checkout === "available" &&
      candidate.failure === null &&
      gitRepositoryPathsEqual(candidate.path, target.path),
  );
  if (!submodule) return null;
  const authorizedTarget: ProjectGitRepositoryTarget = { kind: "submodule", path: submodule.path };
  return {
    target: authorizedTarget,
    repositoryPath: submodule.path,
    contextKey: createGitRepositoryContextKey(projectId, authorizedTarget, submodule.path),
  };
};
