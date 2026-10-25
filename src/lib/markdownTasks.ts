/**
 * GitHub 风格任务列表（`- [ ]` / `- [x]`）的按序切换。渲染侧复选框按文档
 * 顺序编号（见 markdown.ts 的 github_task 规则），本函数与该编号一致：
 * 跳过围栏代码块，只识别真正的列表任务行。
 */

const taskMarkerLinePattern = /^(\s{0,3}(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/;
const fenceLinePattern = /^\s{0,3}(`{3,}|~{3,})/;

interface MarkdownTaskLine {
  lineIndex: number;
  checked: boolean;
}

const collectMarkdownTaskLines = (source: string): MarkdownTaskLine[] => {
  const tasks: MarkdownTaskLine[] = [];
  let fenceMarker = "";
  String(source || "")
    .split(/\r?\n/)
    .forEach((line, lineIndex) => {
      const fenceMatch = fenceLinePattern.exec(line);
      if (fenceMarker) {
        if (fenceMatch && fenceMatch[1][0] === fenceMarker[0] && fenceMatch[1].length >= fenceMarker.length) {
          fenceMarker = "";
        }
        return;
      }
      if (fenceMatch) {
        fenceMarker = fenceMatch[1];
        return;
      }
      const taskMatch = taskMarkerLinePattern.exec(line);
      if (taskMatch) {
        tasks.push({ lineIndex, checked: taskMatch[2].toLowerCase() === "x" });
      }
    });
  return tasks;
};

/** 切换第 index 个任务复选框（按文档顺序，0 起）；越界或无任务时原样返回。 */
export const toggleMarkdownTaskAt = (source: string, index: number): string => {
  const task = collectMarkdownTaskLines(source)[index];
  if (!task) return source;

  const lines = String(source || "").split(/\r?\n/);
  const line = lines[task.lineIndex];
  const replaced = line.replace(/^(\s{0,3}(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_match, prefix: string, marker: string) =>
    `${prefix}[${marker.toLowerCase() === "x" ? " " : "x"}]`,
  );
  if (replaced === line) return source;
  lines[task.lineIndex] = replaced;
  return lines.join("\n");
};
