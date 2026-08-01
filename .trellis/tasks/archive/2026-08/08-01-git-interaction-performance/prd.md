# 优化 Git 交互性能

## Goal

以可重复基线缩短提交 hover preview、单文件暂存/取消暂存和提交历史首屏/分页的等待时间，同时保持仓库切换、外部 Git 变更和并发写操作下的数据正确性。

## Background

- hover preview 已有冷启动延迟、暖切换、按 hash 详情状态和 preload 头像缓存，但文件摘要与头像请求、组件重挂载和仓库切换路径仍需测量重复工作与空白闪烁。
- stage/unstage 已避免完整提交历史刷新，但完成路径仍等待包含 branch、refs、remotes、upstream、status、numstat 的状态快照以及项目 workspace 快照。
- `readGitStatusSnapshot` 并行执行多条 Git 命令，并同步递归读取未跟踪目录；`readGitCommits` 每页同时执行 `git log` 和完整 ref 枚举。
- 本任务依赖 `08-01-git-graph-layout-and-refs` 先稳定图与 ref 数据消费边界。

## Requirements

- R1: 建立可重复性能基线，记录冷/暖场景的 Git 子进程次数、关键命令类别、总耗时和 UI 请求次数；测试仓库必须覆盖分支、merge、tag、已跟踪改动和未跟踪目录。
- R2: 分别测量首次历史加载、追加一页、tooltip 冷打开、tooltip 连续暖切换、单文件 stage 和单文件 unstage；所有优化结论必须对应基线中的实际瓶颈。
- R3: hover preview 的基础提交内容在暖切换时立即替换；同一 repository context 与 hash 的等价详情请求在组件会话中至多一次，在途请求可复用，旧 context 结果不得写入当前卡片。
- R4: 离开行且未经过打开延迟时不得启动详情增强；头像失败、离线或非 GitHub 仓库不影响本地摘要和基础内容。
- R5: stage/unstage 的前台完成路径只等待恢复 staged/unstaged 文件正确性所需的数据，不重读 commits、refs、branches、remotes 或 upstream；非关键 workspace 发现若仍有必要，应与用户可见完成解耦。
- R6: 状态轻量化不能依赖不安全的乐观猜测；rename、untracked、部分暂存、批量操作和外部并发变更必须以 Git 输出为准。
- R7: 历史首屏与分页不得重复执行可在同一仓库/ref 版本内复用的昂贵工作；任何缓存都必须有明确的 repository context、ref 失效和外部刷新策略。
- R8: 若基线显示瓶颈来自 Git 命令或文件系统扫描，优先减少/合并工作；只有 DOM 渲染成为主要瓶颈时才重新规划虚拟列表。
- R9: 优化不得改变当前 80 条分页、自动哨兵单页触发、滚动位置、结构化 refs、写操作串行保护或错误反馈语义。

## Acceptance Criteria

- [ ] AC1: 任务研究记录包含固定 fixture、运行方式、至少五次暖运行的中位数、命令次数和优化前后对照。（R1、R2）
- [ ] AC2: tooltip 冷打开仅在卡片真正显示后加载增强；同一 hash 暖切换无重复等价请求，快速跨行/切仓库无旧结果串入。（R3、R4）
- [ ] AC3: 单文件 stage/unstage 的前台刷新不执行提交历史、ref、branch、remote 或 upstream 查询，文件 staged/unstaged 状态仍由 Git 真实结果校正。（R5、R6）
- [ ] AC4: 首屏与分页的重复工作按基线减少；ref 变化、手动刷新和外部 Git 变化后不会显示过期徽标或提交。（R7）
- [ ] AC5: 四条目标路径的中位耗时均不劣于基线，至少一个确认的主瓶颈获得显著且可解释的改善；报告同时列出未优化项和原因。（R1-R8）
- [ ] AC6: 80 条分页、自动加载、写操作反馈、仓库/项目切换与并发防串线回归测试通过。（R3、R7、R9）
- [ ] AC7: focused Vitest、`npm run validate:git-commits`、`npm run validate:git-workspace`、`node --check public/preload.js`、`npm run type-check` 和 `npm run build` 通过。（R1-R9）

## Out Of Scope

- 没有基线证据时引入虚拟列表、worker、数据库、Git 原生绑定或第三方缓存库。
- 优化 fetch/pull/push 等网络操作、AI 请求或外部编辑器启动。
- 用固定毫秒承诺替代同机同 fixture 的前后基线；不同用户机器和仓库规模不具备统一绝对耗时。
