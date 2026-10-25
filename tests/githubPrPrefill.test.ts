import { describe, expect, it } from "vitest";
import {
  composeGithubPrAiPrompt,
  composeGithubPrPrefill,
  githubPrTemplateName,
  splitGithubPrAiContent,
} from "../src/lib/githubPrPrefill";
import type { GithubPrContext, GithubPrContextCommit } from "../src/types";

const commit = (overrides: Partial<GithubPrContextCommit> = {}): GithubPrContextCommit => ({
  hash: "h1",
  parents: [],
  author: "dev",
  date: "2026-10-25T10:00:00+08:00",
  subject: "feat: add feature",
  message: "feat: add feature",
  ...overrides,
});

describe("composeGithubPrPrefill (github.com 预填规则)", () => {
  const template = "## 变更说明\n- ...";

  it("单提交：标题用提交标题，描述为提交正文 + 模板，并剥离 Co-authored-by", () => {
    const prefill = composeGithubPrPrefill({
      headBranch: "feat/quick",
      repoDefaultBranch: "main",
      nonMergeCommitCount: 1,
      commits: [
        commit({
          subject: "feat: add quick action",
          message: "feat: add quick action\n\nAdds the action.\n\nCo-authored-by: A <a@b.c>",
        }),
      ],
      template,
    });
    expect(prefill.title).toBe("feat: add quick action");
    expect(prefill.description).toBe(`Adds the action.\n\n${template}`);
  });

  it("多提交：标题用分支名人性化，无正文时描述退化为模板", () => {
    const prefill = composeGithubPrPrefill({
      headBranch: "feat/login-page",
      repoDefaultBranch: "main",
      nonMergeCommitCount: 3,
      commits: [commit(), commit({ hash: "h2" }), commit({ hash: "h3" })],
      template,
    });
    expect(prefill.title).toBe("Feat Login Page");
    expect(prefill.description).toBe(template);
  });

  it("无内容时从标题提取 closing issue 引用", () => {
    const prefill = composeGithubPrPrefill({
      headBranch: "fix/crash",
      repoDefaultBranch: "main",
      nonMergeCommitCount: 1,
      commits: [commit({ subject: "Fix #123 crash", message: "Fix #123 crash" })],
      template: "",
    });
    expect(prefill.description).toBe("fixes #123");
  });

  it("模板选择器名称取首个非空行并去掉标题符号", () => {
    expect(githubPrTemplateName("## 🐛 Bug 报告\n\n描述", 0)).toBe("🐛 Bug 报告");
    expect(githubPrTemplateName("", 2)).toBe("模板 3");
  });
});

describe("composeGithubPrAiPrompt", () => {
  const context: GithubPrContext = {
    baseRemote: "origin",
    baseBranch: "main",
    headBranch: "feat/x",
    mergeBase: "abc",
    commits: [
      commit({ message: "feat: add feature\n\nImplements the feature end to end." }),
      commit({ hash: "h2", subject: "chore: cleanup", message: "chore: cleanup", parents: ["h1", "h9"] }),
    ],
    commitsTruncated: false,
    totalCommits: 12,
    nonMergeCommitCount: 11,
    files: [
      { path: "src/a.ts", additions: 10, deletions: 2, binary: false },
      { path: "assets/logo.png", additions: null, deletions: null, binary: true },
    ],
    filesTruncated: false,
    noisyDiffExcluded: true,
    diffStat: " 2 files changed",
    diffStatTruncated: false,
    diff: "diff --git a/x b/x",
    diffTruncated: false,
  };

  it("组装仓库/分支/提交正文/文件清单/diff/模板各节", () => {
    const prompt = composeGithubPrAiPrompt({
      modePrompt: "生成 PR 内容。",
      context,
      repositoryLabel: "wyxa/app",
      template: "## 模板",
      remoteName: "origin",
    });
    expect(prompt).toContain("共 12 条提交，仅列出前 2 条");
    expect(prompt).toContain("(merge)");
    expect(prompt).toContain("Implements the feature end to end.");
    expect(prompt).toContain("- src/a.ts (+10/-2)");
    expect(prompt).toContain("- assets/logo.png（二进制）");
    expect(prompt).toContain("噪音文件的 diff 已省略");
    expect(prompt).toContain("diff --git a/x b/x");
    expect(prompt).toContain("## 模板");
  });

  it("追问时附带改进要求与上一版结果；空 diffs/模板时节省略", () => {
    const refinement = composeGithubPrAiPrompt({
      modePrompt: "p",
      context: { ...context, diff: "", diffStat: "", files: [], noisyDiffExcluded: false },
      repositoryLabel: "wyxa/app",
      template: "",
      remoteName: "origin",
      previous: { title: "feat: old", description: "旧版描述" },
      instruction: "更简洁",
    });
    expect(refinement).toContain("改进要求：\n更简洁");
    expect(refinement).toContain("TITLE: feat: old");
    expect(refinement).toContain("DESCRIPTION:\n旧版描述");
    expect(refinement).toContain("代码 diff：无内容。");
    expect(refinement).not.toContain("PR 模板");
    expect(refinement).not.toContain("变更文件");
  });
});

describe("splitGithubPrAiContent", () => {
  it("优先识别 TITLE/DESCRIPTION 标记（兼容中文冒号与行内标记）", () => {
    expect(splitGithubPrAiContent("TITLE: feat: t\n\nDESCRIPTION:\nbody")).toEqual({
      title: "feat: t",
      description: "body",
    });
    expect(splitGithubPrAiContent("TITLE：中文标题\n\nDESCRIPTION: 第一行\n第二行")).toEqual({
      title: "中文标题",
      description: "第一行\n第二行",
    });
  });

  it("缺标记时回退为第一行标题，并剥离代码围栏", () => {
    expect(splitGithubPrAiContent("```\nfeat: t\nbody\n```")).toEqual({ title: "feat: t", description: "body" });
    expect(splitGithubPrAiContent("TITLE: only\n\n正文直接开始").title).toBe("TITLE: only");
    expect(splitGithubPrAiContent("   ")).toEqual({ title: "", description: "" });
  });
});
