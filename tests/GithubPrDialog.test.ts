// @vitest-environment happy-dom

import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GithubPrDialog from "../src/components/project/GithubPrDialog.vue";

const store = vi.hoisted(() => ({
  locale: "zh-CN",
  aiPreferences: { modes: [] },
  gitSnapshotForRepository: vi.fn(),
  fetchGitRemoteByName: vi.fn(),
  readGithubRepositoryMetadata: vi.fn(),
  readGithubPullRequestTemplates: vi.fn(),
  readGithubOpenPullRequest: vi.fn(),
  readGithubPrContext: vi.fn(),
  pushGitRemote: vi.fn(),
  publishGitBranch: vi.fn(),
  refreshGitSnapshot: vi.fn(),
  createGithubPullRequest: vi.fn(),
  updateGithubPullRequest: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("../src/store/useStore", () => ({ useStore: () => store }));

const apps: App[] = [];
const repositoryTarget = { kind: "main" as const };
const pullRequest = {
  number: 357,
  title: "Existing pull request",
  body: "## Existing description\n\n- [ ] Review existing changes",
  url: "https://github.com/example/app/pull/357",
  isDraft: false,
  state: "open" as const,
  baseBranch: "develop",
  headBranch: "feature/example",
};
const createSnapshot = () => reactive({
  repositoryPath: "D:/example",
  branch: "feature/example",
  remotes: [{ name: "origin", fetchUrl: "https://github.com/example/app.git", pushUrl: "https://github.com/example/app.git" }],
  remoteBranches: [{ remote: "origin", branch: "main" }],
  upstream: { remote: "origin", branch: "feature/example", ahead: 2, behind: 0 },
});
let snapshot: ReturnType<typeof createSnapshot>;

beforeEach(() => {
  snapshot = createSnapshot();
  store.gitSnapshotForRepository.mockReturnValue(snapshot);
  store.fetchGitRemoteByName.mockResolvedValue({ ok: true });
  store.readGithubRepositoryMetadata.mockResolvedValue({
    ok: true,
    value: { owner: "example", repository: "app", nodeId: "R_1", defaultBranch: "main", isFork: false, parent: null },
  });
  store.readGithubPullRequestTemplates.mockResolvedValue({ ok: true, value: ["## Summary"] });
  store.readGithubOpenPullRequest.mockResolvedValue({ ok: true, value: pullRequest });
  store.readGithubPrContext.mockResolvedValue({
    ok: true,
    value: {
      headBranch: "feature/example",
      baseBranch: "main",
      totalCommits: 2,
      nonMergeCommitCount: 2,
      commits: [],
      diff: "",
      commitsTruncated: false,
      diffTruncated: false,
    },
  });
  store.pushGitRemote.mockResolvedValue({ ok: true, message: "推送成功" });
  store.updateGithubPullRequest.mockImplementation(async (input: { title: string; body: string }) => ({
    ok: true, value: { ...pullRequest, title: input.title, body: input.body },
  }));
  store.refreshGitSnapshot.mockImplementation(async () => { snapshot.upstream.ahead = 0; });
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

const buttonWithText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === text);

const mountDialog = async () => {
  const open = ref(false);
  const feedback = vi.fn();
  const close = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({
    render: () => h(GithubPrDialog, {
      open: open.value,
      projectId: "project-1",
      repositoryTarget,
      onFeedback: feedback,
      onClose: close,
    }),
  });
  app.directive("overlay-scrollbar", {});
  app.mount(root);
  apps.push(app);
  open.value = true;
  await nextTick();
  return { feedback, close, open };
};

describe("existing pull request updates", () => {
  it("keeps existing PR details in the creation form and hides the push action after pushing", async () => {
    const contextResult = store.readGithubPrContext.getMockImplementation()!();
    let finishContext!: () => void;
    store.readGithubPrContext.mockReturnValueOnce(new Promise((resolve) => {
      finishContext = () => resolve(contextResult);
    }));
    const { feedback, open } = await mountDialog();
    await vi.waitFor(() => expect(buttonWithText("推送 2 个提交")).toBeDefined());

    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("创建 GitHub PR");
    expect(document.body.textContent).toContain("feature/example → develop");
    expect(document.body.textContent).toContain("推送后将更新 PR #357");
    expect(document.querySelector<HTMLInputElement>('[aria-label="PR 标题"]')?.value).toBe(pullRequest.title);
    expect(buttonWithText("预览")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[aria-label="PR 描述预览"]')?.textContent).toContain("Existing description");
    expect(document.querySelector('[aria-label="PR 描述"]')).toBeNull();
    expect(buttonWithText("创建 PR")?.disabled).toBe(true);
    expect(store.readGithubPrContext).toHaveBeenCalledWith("project-1", repositoryTarget, {
      baseRemote: "origin", baseBranch: "develop", headBranch: "feature/example",
    });

    buttonWithText("编辑")!.click();
    await nextTick();
    const description = document.querySelector<HTMLTextAreaElement>('[aria-label="PR 描述"]')!;
    description.value = "Edited before context finished";
    description.dispatchEvent(new Event("input", { bubbles: true }));
    finishContext();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[aria-label="PR 标题"]')?.disabled).toBe(false));
    expect(description.value).toBe("Edited before context finished");
    buttonWithText("打开 PR")!.click();
    expect(store.openExternalUrl).toHaveBeenCalledExactlyOnceWith(pullRequest.url);
    buttonWithText("推送 2 个提交")!.click();
    await vi.waitFor(() => expect(feedback).toHaveBeenLastCalledWith("success", "提交已推送到源分支，PR #357 已更新。", { retainRemoteProgress: true }));
    expect(store.pushGitRemote).toHaveBeenCalledExactlyOnceWith("project-1", repositoryTarget);
    expect(description.value).toBe("Edited before context finished");
    expect(buttonWithText("推送 2 个提交")).toBeUndefined();
    expect(document.body.textContent).not.toContain("当前分支没有待推送的提交");
    expect(store.createGithubPullRequest).not.toHaveBeenCalled();
    open.value = false;
    await nextTick();
    store.readGithubOpenPullRequest.mockResolvedValue({ ok: true, value: null });
    open.value = true;
    await vi.waitFor(() => expect(buttonWithText("创建 PR")?.disabled).toBe(false));
    expect(buttonWithText("编辑")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="PR 描述"]')?.value).toContain("## Summary");
    expect(buttonWithText("保存修改")).toBeUndefined();
  });

  it("preserves edits on failure and saves title and description without pushing commits", async () => {
    store.updateGithubPullRequest.mockResolvedValueOnce({ ok: false, failure: { message: "没有修改权限" } });
    snapshot.upstream.ahead = 0;
    const { feedback } = await mountDialog();
    await vi.waitFor(() => expect(buttonWithText("保存修改")).toBeDefined());
    expect(buttonWithText("保存修改")?.disabled).toBe(true);
    const title = document.querySelector<HTMLInputElement>('[aria-label="PR 标题"]')!;
    title.value = "Updated title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    buttonWithText("编辑")!.click();
    await nextTick();
    const description = document.querySelector<HTMLTextAreaElement>('[aria-label="PR 描述"]')!;
    description.value = "## Updated description";
    description.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(buttonWithText("保存修改")?.disabled).toBe(false);
    buttonWithText("保存修改")!.click();

    await vi.waitFor(() => expect(feedback).toHaveBeenLastCalledWith("error", "没有修改权限", undefined));
    expect(title.value).toBe("Updated title");
    expect(description.value).toBe("## Updated description");
    buttonWithText("保存修改")!.click();
    await vi.waitFor(() => expect(feedback).toHaveBeenLastCalledWith("success", "PR #357 修改已保存。", undefined));
    expect(store.updateGithubPullRequest).toHaveBeenLastCalledWith({
      owner: "example", repository: "app", number: 357, title: "Updated title", body: "## Updated description",
    });
    expect(buttonWithText("保存修改")?.disabled).toBe(true);
    expect(store.pushGitRemote).not.toHaveBeenCalled();
    expect(store.createGithubPullRequest).not.toHaveBeenCalled();
    buttonWithText("预览")!.click();
    await nextTick();
    expect(document.querySelector('[aria-label="PR 描述预览"]')?.textContent).toContain("Updated description");
  });

  it("saves a title-only change, rejects empty titles, and detects reverted edits", async () => {
    snapshot.upstream.ahead = 0;
    const { feedback } = await mountDialog();
    await vi.waitFor(() => expect(buttonWithText("保存修改")).toBeDefined());
    const title = document.querySelector<HTMLInputElement>('[aria-label="PR 标题"]')!;
    const changeTitle = async (value: string) => {
      title.value = value;
      title.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();
    };
    await changeTitle("New title");
    expect(buttonWithText("保存修改")?.disabled).toBe(false);
    await changeTitle(pullRequest.title);
    expect(buttonWithText("保存修改")?.disabled).toBe(true);
    for (const value of ["", "   "]) {
      await changeTitle(value);
      expect(buttonWithText("保存修改")?.disabled).toBe(true);
      expect(buttonWithText("保存修改")?.title).toBe("请填写 PR 标题");
      buttonWithText("保存修改")!.click();
    }
    expect(store.updateGithubPullRequest).not.toHaveBeenCalled();
    await changeTitle("  New title  ");
    buttonWithText("保存修改")!.click();
    await vi.waitFor(() => expect(feedback).toHaveBeenLastCalledWith("success", "PR #357 修改已保存。", undefined));
    expect(store.updateGithubPullRequest).toHaveBeenCalledExactlyOnceWith({
      owner: "example", repository: "app", number: 357, title: "New title", body: pullRequest.body,
    });
    expect(title.value).toBe("New title");
    expect(buttonWithText("保存修改")?.disabled).toBe(true);
    expect(store.pushGitRemote).not.toHaveBeenCalled();
  });

});