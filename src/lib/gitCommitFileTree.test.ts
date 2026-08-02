import { describe, expect, it } from "vitest";
import type { ProjectGitFileChange } from "../types";
import { buildCommitFileItems, normalizeCommitFilePath } from "./gitCommitFileTree";

const file = (path: string, originalPath?: string): ProjectGitFileChange => ({
  path,
  ...(originalPath ? { originalPath } : {}),
  additions: 0,
  deletions: 0,
  status: "MODIFIED",
});

describe("buildCommitFileItems", () => {
  it("normalizes paths, sorts directories before files, and compacts single-directory chains", () => {
    const zetaFile = file("zeta\\deep\\only.ts");
    const srcParseFile = file("src\\utils\\parse.ts");
    const rootFile = file("README.md", "OLD_README.md");
    const srcAlphaFile = file("src/alpha.ts");
    const deepFile = file("root/a/b/thing.ts");
    const srcFormatFile = file("src\\utils\\format.ts");

    expect(normalizeCommitFilePath("\\src\\\\utils//format.ts/")).toBe("src/utils/format.ts");
    expect(
      buildCommitFileItems([zetaFile, srcParseFile, rootFile, srcAlphaFile, deepFile, srcFormatFile], {
        mode: "tree",
        collapsedPaths: {},
      }),
    ).toEqual([
      {
        kind: "directory",
        key: "directory:root/a/b",
        name: "root \\ a \\ b",
        path: "root/a/b",
        depth: 0,
        isExpanded: true,
      },
      { kind: "file", key: "file::root/a/b/thing.ts", file: deepFile, depth: 1 },
      {
        kind: "directory",
        key: "directory:src",
        name: "src",
        path: "src",
        depth: 0,
        isExpanded: true,
      },
      {
        kind: "directory",
        key: "directory:src/utils",
        name: "utils",
        path: "src/utils",
        depth: 1,
        isExpanded: true,
      },
      { kind: "file", key: "file::src\\utils\\format.ts", file: srcFormatFile, depth: 2 },
      { kind: "file", key: "file::src\\utils\\parse.ts", file: srcParseFile, depth: 2 },
      { kind: "file", key: "file::src/alpha.ts", file: srcAlphaFile, depth: 1 },
      {
        kind: "directory",
        key: "directory:zeta/deep",
        name: "zeta \\ deep",
        path: "zeta/deep",
        depth: 0,
        isExpanded: true,
      },
      { kind: "file", key: "file::zeta\\deep\\only.ts", file: zetaFile, depth: 1 },
      { kind: "file", key: "file:OLD_README.md:README.md", file: rootFile, depth: 0 },
    ]);
  });

  it("defaults directories to expanded, honors collapsed normalized paths, and preserves list order", () => {
    const nestedFile = file("src\\utils\\format.ts", "src\\legacy\\format.ts");
    const rootFile = file("README.md");

    expect(
      buildCommitFileItems([nestedFile, rootFile], {
        mode: "tree",
        collapsedPaths: { "src/utils": false },
      }),
    ).toEqual([
      {
        kind: "directory",
        key: "directory:src/utils",
        name: "src \\ utils",
        path: "src/utils",
        depth: 0,
        isExpanded: false,
      },
      { kind: "file", key: "file::README.md", file: rootFile, depth: 0 },
    ]);

    expect(
      buildCommitFileItems([nestedFile, rootFile], {
        mode: "list",
        collapsedPaths: { "src/utils": false },
      }),
    ).toEqual([
      {
        kind: "file",
        key: "file:src\\legacy\\format.ts:src\\utils\\format.ts",
        file: nestedFile,
        depth: 0,
      },
      { kind: "file", key: "file::README.md", file: rootFile, depth: 0 },
    ]);
  });
});
