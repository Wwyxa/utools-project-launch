import type { GithubPrContext, GithubPrContextCommit, GithubPrContextFile } from "../types";

/**
 * github.com 风格的 PR 标题/描述预填规则，参考 vscode-pull-request-github 的
 * getTitleAndDescription 实现：单提交用提交标题，多提交用分支名；描述优先
 * 「单提交正文 + 模板」，其次模板、提交正文，最后回退标题中的 issue 引用。
 */

const coAuthoredByLinePattern = /^Co-authored-by:.*$/gim;
const issueReferencePattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i;
const bareIssuePattern = /#(\d+)\b/;

const stripCoAuthoredByTrailers = (body: string) =>
  body.replace(coAuthoredByLinePattern, "").replace(/\n{3,}/g, "\n\n").trim();

const commitBodyOf = (message: string) => {
  const lines = String(message || "").split("\n");
  return lines.length > 1 ? stripCoAuthoredByTrailers(lines.slice(1).join("\n").trim()) : "";
};

const humanizeGithubBranchName = (branch: string) => {
  const words = String(branch || "")
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  if (words.length === 0) return "";
  return `${words.join(" ")}`;
};

/** 跳过 merge 提交，取范围内最新的一条普通提交。 */
const githubPrTipCommit = (commits: readonly GithubPrContextCommit[]): GithubPrContextCommit | null => {
  for (const commit of commits) {
    if (commit.parents.length < 2) return commit;
  }
  return commits[0] ?? null;
};

export interface GithubPrPrefillInput {
  headBranch: string;
  repoDefaultBranch: string;
  /** base..head 范围内的非 merge 提交数；未知传 -1。 */
  nonMergeCommitCount: number;
  commits: readonly GithubPrContextCommit[];
  template: string;
}

export interface GithubPrPrefill {
  title: string;
  description: string;
}

const issueReferenceFromBody = (title: string) => {
  const issueNumber = issueReferencePattern.exec(title)?.[1] ?? bareIssuePattern.exec(title)?.[1];
  return issueNumber ? `fixes #${issueNumber}` : "";
};

export const composeGithubPrPrefill = (input: GithubPrPrefillInput): GithubPrPrefill => {
  const headBranch = String(input.headBranch || "").trim();
  const repoDefaultBranch = String(input.repoDefaultBranch || "").trim();
  const template = String(input.template || "").trim();
  const nonMergeCount = Number.isFinite(input.nonMergeCommitCount) ? input.nonMergeCommitCount : -1;
  const tipCommit = githubPrTipCommit(input.commits);
  const tipBody = tipCommit ? commitBodyOf(tipCommit.message) : "";

  const useBranchName =
    (nonMergeCount === -1 || nonMergeCount > 1 || headBranch === repoDefaultBranch) && headBranch !== "";
  const title = useBranchName ? humanizeGithubBranchName(headBranch) : (tipCommit?.subject || "");

  let description = "";
  if (!useBranchName && tipBody && template) {
    description = `${tipBody}\n\n${template}`;
  } else if (template) {
    description = template;
  } else if (!useBranchName && tipBody) {
    description = tipBody;
  } else {
    description = title ? issueReferenceFromBody(title) : "";
  }

  return { title, description };
};

/** 模板选择器展示名：取第一行非空文本，去掉 Markdown 标题符号。 */
export const githubPrTemplateName = (body: string, index: number) => {
  const firstLine =
    String(body || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || "";
  const label = firstLine.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
  return label || `模板 ${index + 1}`;
};

const aiPromptCommitLimit = 50;
const aiPromptCommitBodyLimit = 15;
const aiPromptCommitBodyMaxChars = 400;
const aiPromptFileLimit = 60;

export interface GithubPrAiPromptInput {
  modePrompt: string;
  context: GithubPrContext;
  repositoryLabel: string;
  template: string;
  remoteName: string;
  /** 追问改进时传入上一版生成结果。 */
  previous?: { title: string; description: string } | null;
  /** 追问的修改要求；为空表示在上一版基础上重新生成。 */
  instruction?: string;
}

const formatCommitBodyLines = (body: string) => {
  const normalized = body.trim();
  if (!normalized) return "";
  const clipped =
    normalized.length > aiPromptCommitBodyMaxChars
      ? `${normalized.slice(0, aiPromptCommitBodyMaxChars)}…`
      : normalized;
  return `\n  ${clipped.split(/\r?\n/).join("\n  ")}`;
};

const formatCommitLines = (commits: readonly GithubPrContextCommit[]) =>
  commits
    .map((commit, index) => {
      const mergeMark = commit.parents.length > 1 ? " (merge)" : "";
      const body = index < aiPromptCommitBodyLimit ? commitBodyOf(commit.message) : "";
      return `- ${commit.subject}${mergeMark} — ${commit.author}${formatCommitBodyLines(body)}`;
    })
    .join("\n");

const formatFileLines = (files: readonly GithubPrContextFile[], truncated: boolean) => {
  const lines = files
    .slice(0, aiPromptFileLimit)
    .map((file) => {
      if (file.binary) return `- ${file.path}（二进制）`;
      return `- ${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`;
    })
    .join("\n");
  const moreNote =
    files.length > aiPromptFileLimit ? `\n（共 ${files.length} 个变更文件，仅列出前 ${aiPromptFileLimit} 个${truncated ? "，且已截断" : ""}）` : "";
  return `${lines}${moreNote}`;
};

/** 组装 PR 描述 AI 生成的完整提示词：模式提示词 + 仓库/分支/提交/文件/diff 上下文。 */
export const composeGithubPrAiPrompt = (input: GithubPrAiPromptInput) => {
  const { context } = input;
  const commits = context.commits.slice(0, aiPromptCommitLimit);
  const commitsTruncatedNote =
    context.totalCommits > commits.length ? `\n（共 ${context.totalCommits} 条提交，仅列出前 ${commits.length} 条）` : "";
  const templateSection = input.template.trim()
    ? `\n\nPR 模板（请按此结构组织正文）：\n${input.template.trim()}`
    : "";
  const noisyNote = context.noisyDiffExcluded
    ? "（锁定文件/构建产物等噪音文件的 diff 已省略，完整清单见变更文件列表）"
    : "";
  const diffSection = context.diff.trim()
    ? `\n\n代码 diff（${context.diffTruncated ? "已截断" : "完整"}）${noisyNote}：\n${context.diff}`
    : "\n\n代码 diff：无内容。";
  const diffStatSection = context.diffStat.trim()
    ? `\n\n变更统计：\n${context.diffStat}${context.diffStatTruncated ? "\n（diffstat 已截断）" : ""}`
    : "";
  const filesSection =
    context.files.length > 0
      ? `\n\n变更文件（${context.files.length} 个${context.filesTruncated ? "，已截断" : ""}）：\n${formatFileLines(context.files, context.filesTruncated)}`
      : "";
  const refinementSection =
    input.previous && (input.previous.title || input.previous.description)
      ? [
          "",
          "改进要求：",
          input.instruction?.trim() || "请在保持输出格式的前提下重新生成一版。",
          "",
          "上一版生成结果（请在其基础上改进）：",
          `TITLE: ${input.previous.title}`,
          "",
          "DESCRIPTION:",
          input.previous.description,
        ].join("\n")
      : "";

  return [
    String(input.modePrompt || "").trim(),
    "",
    "仓库上下文：",
    `- 仓库：${input.repositoryLabel}`,
    `- 源分支：${context.headBranch}（远端 ${input.remoteName}）`,
    `- 目标分支：${context.baseBranch}`,
    `- 提交数：${context.totalCommits}（非 merge ${context.nonMergeCommitCount}）`,
    "",
    "提交记录（新到旧）：",
    `${formatCommitLines(commits)}${commitsTruncatedNote || ""}`,
    filesSection.trimStart(),
    diffStatSection.trimStart(),
    diffSection.trimStart(),
    templateSection.trimStart(),
    refinementSection,
  ]
    .filter((section) => section !== "")
    .join("\n");
};

const aiTitleMarkerPattern = /^\s*(?:#+\s*)?TITLE\s*[:：]\s*/i;
const aiDescriptionMarkerPattern = /^\s*(?:#+\s*)?DESCRIPTION\s*[:：]\s*/i;

/**
 * 从 AI 生成结果中拆出标题与描述。优先识别 `TITLE:` / `DESCRIPTION:`
 * 标记格式；模型未按格式输出时回退为“第一行标题 + 其余描述”。
 */
export const splitGithubPrAiContent = (content: string): GithubPrPrefill => {
  const normalized = String(content || "")
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (!normalized) return { title: "", description: "" };

  const lines = normalized.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => aiTitleMarkerPattern.test(line));
  const descriptionIndex = lines.findIndex((line) => aiDescriptionMarkerPattern.test(line));
  if (titleIndex >= 0 && descriptionIndex > titleIndex) {
    const title = lines
      .slice(titleIndex, descriptionIndex)
      .map((line, index) => (index === 0 ? line.replace(aiTitleMarkerPattern, "") : line))
      .join(" ")
      .trim();
    const descriptionFirstLine = lines[descriptionIndex].replace(aiDescriptionMarkerPattern, "");
    const description = [descriptionFirstLine, ...lines.slice(descriptionIndex + 1)].join("\n").trim();
    return { title, description };
  }

  const [firstLine, ...restLines] = lines;
  return {
    title: firstLine.replace(/^#+\s*/, "").trim(),
    description: restLines.join("\n").trim(),
  };
};
