import type { ProjectGitFileChange } from "../types";

export type CommitFileViewMode = "list" | "tree";

export type CommitFileDirectoryItem = {
  kind: "directory";
  key: string;
  name: string;
  path: string;
  depth: number;
  isExpanded: boolean;
};

export type CommitFileItem = {
  kind: "file";
  key: string;
  file: ProjectGitFileChange;
  depth: number;
};

export type CommitFileDisplayItem = CommitFileDirectoryItem | CommitFileItem;

export interface BuildCommitFileItemsOptions {
  mode: CommitFileViewMode;
  collapsedPaths: Readonly<Record<string, boolean>>;
}

type CommitFileTreeNode = { directories: Map<string, CommitFileTreeNode>; files: ProjectGitFileChange[] };

const createCommitFileTreeNode = (): CommitFileTreeNode => ({ directories: new Map(), files: [] });
const compareCommitFileTreeNames = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);
const commitFileItemKey = (file: ProjectGitFileChange) => `file:${file.originalPath || ""}:${file.path}`;

export const normalizeCommitFilePath = (path: string) => path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");

export const buildCommitFileItems = (
  files: readonly ProjectGitFileChange[],
  { mode, collapsedPaths }: BuildCommitFileItemsOptions,
): CommitFileDisplayItem[] => {
  if (mode === "list") {
    return files.map((file): CommitFileItem => ({ kind: "file", key: commitFileItemKey(file), file, depth: 0 }));
  }

  const root = createCommitFileTreeNode();
  for (const file of files) {
    const segments = normalizeCommitFilePath(file.path).split("/").filter(Boolean);
    if (segments.length === 0) {
      root.files.push(file);
      continue;
    }

    let node = root;
    for (const directoryName of segments.slice(0, -1)) {
      let directory = node.directories.get(directoryName);
      if (!directory) {
        directory = createCommitFileTreeNode();
        node.directories.set(directoryName, directory);
      }
      node = directory;
    }
    node.files.push(file);
  }

  const items: CommitFileDisplayItem[] = [];
  const appendItems = (node: CommitFileTreeNode, parentPath: string, depth: number) => {
    for (const [name, directory] of [...node.directories.entries()].sort(([left], [right]) =>
      compareCommitFileTreeNames(left, right),
    )) {
      let compactName = name;
      let compactPath = parentPath ? `${parentPath}/${name}` : name;
      let compactDirectory = directory;
      while (compactDirectory.files.length === 0 && compactDirectory.directories.size === 1) {
        const [childName, childDirectory] = [...compactDirectory.directories.entries()][0]!;
        compactName += ` \\ ${childName}`;
        compactPath = `${compactPath}/${childName}`;
        compactDirectory = childDirectory;
      }

      const isExpanded = collapsedPaths[compactPath] !== false;
      items.push({
        kind: "directory",
        key: `directory:${compactPath}`,
        name: compactName,
        path: compactPath,
        depth,
        isExpanded,
      });
      if (isExpanded) appendItems(compactDirectory, compactPath, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) =>
      compareCommitFileTreeNames(normalizeCommitFilePath(left.path), normalizeCommitFilePath(right.path)),
    )) {
      items.push({ kind: "file", key: commitFileItemKey(file), file, depth });
    }
  };

  appendItems(root, "", 0);
  return items;
};
