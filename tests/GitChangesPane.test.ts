// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitChangesPane from "../src/components/project/GitChangesPane.vue";
import type { ProjectGitFileChange } from "../src/types";

const store = vi.hoisted(() => ({
  locale: "zh-CN",
  aiPreferences: { modes: [] },
  resolveGitRepositoryContext: vi.fn(() => ({ contextKey: "main", repositoryPath: "D:/example" })),
  gitSnapshotForRepository: vi.fn(),
  stageGitFiles: vi.fn(),
  unstageGitFiles: vi.fn(),
  discardGitFiles: vi.fn(),
}));

vi.mock("../src/store/useStore", () => ({ useStore: () => store }));
vi.mock("../src/lib/visualFeedback", () => ({ waitForVisualFeedback: () => Promise.resolve() }));
vi.mock("../src/components/common/FileIcon.vue", () => ({ default: { template: "<span />" } }));

const apps: App[] = [];
const repositoryTarget = { kind: "main" as const };
const file = (path: string, staged = false): ProjectGitFileChange => ({
  path,
  staged,
  unstaged: !staged,
  status: "MODIFIED",
  additions: 1,
  deletions: 0,
});

beforeEach(() => {
  for (const action of [store.stageGitFiles, store.unstageGitFiles, store.discardGitFiles]) {
    action.mockReset().mockResolvedValue({ ok: true, message: "完成" });
  }
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const mountPane = async (files: ProjectGitFileChange[]) => {
  store.gitSnapshotForRepository.mockReturnValue({ files, commits: [], repositoryPath: "D:/example" });
  const root = document.createElement("div");
  document.body.append(root);
  const selectFile = vi.fn();
  const app = createApp(GitChangesPane, {
    projectId: "project-1",
    repositoryTarget,
    open: true,
    commitMessage: "",
    selection: { path: "src-other/outside.ts", scope: "unstaged" },
    onSelectFile: selectFile,
  });
  app.directive("overlay-scrollbar", {});
  app.mount(root);
  apps.push(app);
  root.querySelector<HTMLButtonElement>('[aria-label="切换为树形文件列表"]')?.click();
  await nextTick();
  return { root, selectFile };
};

const click = async (root: ParentNode, selector: string) => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  button!.click();
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

describe("worktree directory actions", () => {
  it("stages only the current group's descendants, including collapsed children and normalized paths", async () => {
    const { root, selectFile } = await mountPane([
      file("src/first.ts"),
      file("src\\nested\\second.ts"),
      file("src/staged-only.ts", true),
      file("src-other/outside.ts"),
    ]);
    const directory = root.querySelector('[aria-label="暂存文件夹：src"]')!.closest(".group")!;
    await click(directory, 'button[aria-expanded="true"]');
    expect(directory.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    await click(root, '[aria-label="暂存文件夹：src"]');

    expect(store.stageGitFiles).toHaveBeenCalledExactlyOnceWith(
      "project-1",
      ["src/first.ts", "src\\nested\\second.ts"],
      { all: false },
      repositoryTarget,
    );
    expect(selectFile).not.toHaveBeenCalled();
    expect(directory.querySelector('button[aria-expanded="false"]')).not.toBeNull();
  });

  it("unstages only staged files in a compact directory", async () => {
    const { root } = await mountPane([
      file("lib/deep/first.ts", true),
      file("lib/deep/nested/second.ts", true),
      file("lib/deep/unstaged-only.ts"),
      file("library/outside.ts", true),
    ]);
    await click(root, '[aria-label="取消暂存文件夹：lib/deep"]');
    expect(store.unstageGitFiles).toHaveBeenCalledExactlyOnceWith(
      "project-1",
      ["lib/deep/first.ts", "lib/deep/nested/second.ts"],
      { all: false },
      repositoryTarget,
    );
  });

  it.each([false, true])("confirms directory discard without including other groups (staged: %s)", async (staged) => {
    const { root } = await mountPane([
      file("src/first.ts", staged),
      file("src/nested/second.ts", staged),
      file("src/other-group.ts", !staged),
      file("src-other/outside.ts", staged),
    ]);
    const groups = root.querySelectorAll("section > .git-subsection-bar");
    const group = groups[staged ? 0 : 1]!.parentElement!;
    await click(group, '[aria-label="丢弃文件夹变更：src"]');
    expect(store.discardGitFiles).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("2 个文件在工作区与暂存区");
    expect(dialog.textContent).toContain("src/nested/second.ts");
    expect(dialog.textContent).not.toContain("src/other-group.ts");
    await click(dialog, 'button[type="submit"]');
    expect(store.discardGitFiles).toHaveBeenCalledExactlyOnceWith(
      "project-1",
      ["src/first.ts", "src/nested/second.ts"],
      { all: false },
      repositoryTarget,
    );
  });

});
