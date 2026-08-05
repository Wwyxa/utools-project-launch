# 应用与回退历史提交

## Goal

让用户可以从提交历史中把一个既有提交应用到当前分支，或用一个新的反向提交撤销其影响，同时为冲突和不支持的提交形态提供安全边界。

## Background

- 当前提交历史右键菜单已经承载检出提交、分支、标签和 stash 操作，适合作为单提交动作入口。
- 当前提交模型包含父提交列表，可识别普通提交与 merge commit。
- 当前多选提交只服务于 AI 分析；把它直接用于写操作会引入顺序、部分成功和冲突恢复问题。

## Requirements

- R1：普通非 merge 提交的右键菜单提供“Cherry-pick 到当前分支”和“Revert 此提交”操作。
- R2：首版每次只处理一个提交，不复用提交多选状态执行批量写操作。
- R3：cherry-pick 把所选提交应用到当前 HEAD 并创建新提交；不允许选择当前 HEAD、stash 伪提交或 merge commit。
- R4：revert 为所选提交创建新的反向提交，不移动已有分支历史；不允许选择 stash 伪提交或 merge commit。
- R5：两项操作都要求 HEAD 附着于本地分支且工作区和暂存区干净；detached HEAD 或 dirty worktree 不执行并说明原因。
- R6：两项操作执行前显示目标提交短哈希、标题和语义明确的确认信息。
- R7：操作作用于当前选中的可用仓库上下文；成功后刷新提交、引用、状态和工作区信息。
- R8：cherry-pick 或 revert 发生冲突时立即执行对应的 `--abort`；无论 abort 是否成功，都返回普通失败结果，不保留冲突工作流或新增恢复状态枚举。
- R9：abort 成功时失败信息说明仓库已恢复；abort 失败时保留原始操作错误和 abort 错误并强制全量刷新，插件不尝试 continue、skip、二次清理或猜测仓库状态。
- R10：两种冲突结果都提示可使用专业 Git 工具，并说明可在外部应用设置中完成配置后通过现有仓库菜单打开；提示不提供直接启动操作。

## Acceptance Criteria

- [ ] 干净工作区可以 cherry-pick 一个普通提交，并在当前分支生成内容与来源提交一致的新提交。
- [ ] 干净工作区可以 revert 一个普通提交，并生成反向提交而不移动已有提交历史。
- [ ] 当前 HEAD、stash、merge commit 或脏工作区不会执行不受支持的操作，并显示原因。
- [ ] detached HEAD 不会执行 cherry-pick/revert，也不会创建新的悬空提交。
- [ ] 用户取消确认时仓库不发生变化。
- [ ] 成功后提交图、引用、ahead/behind 和工作区状态与 Git 实际状态一致。
- [ ] cherry-pick/revert 冲突且 abort 成功后，HEAD、index 和工作区恢复到操作前状态，并显示“已自动恢复”提示。
- [ ] abort 失败时不伪造恢复成功或新增专用恢复状态，界面保留真实错误并提示专业工具及外部应用配置路径，但不直接启动外部应用。

## Out of Scope

- 多提交 cherry-pick/revert、merge commit 主父提交选择和交互式冲突解决器。
- cherry-pick/revert 的 continue、skip 和 edit/no-commit 选项。
