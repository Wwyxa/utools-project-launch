# 扩展 Git 操作能力 - Implementation Plan

## Execution Order

1. 实施并检查 `08-05-git-repository-publish`。
2. 实施并检查 `08-05-git-last-commit-correction`。
3. 实施并检查 `08-05-git-history-actions`。
4. 返回父任务执行完整 Git 集成检查和手动验收。

子任务必须逐个进入 `in_progress`、实现、检查和提交。父任务不作为产品代码实现目标。

## Integration Checklist

- [ ] 确认六项操作都作用于预期项目或当前 repository target。
- [ ] 确认并发 Git 写操作仍被统一锁定，切换 repository 时不会把结果写入旧上下文。
- [ ] 确认新增 Git action、结果字段和必要 blocker 在 preload、shared type、fallback、store 和 UI 中一致。
- [ ] 确认 GitTab 顶部、Changes toolbar 和历史上下文菜单在窄窗口中没有溢出或重叠。
- [ ] 确认冲突提示仅说明可配置并使用外部应用，不提供直接启动操作；现有仓库菜单行为保持不变。
- [ ] 确认 browser fallback 对所有新方法返回可用的失败结果而不是抛错。

## Final Validation

```bash
node --check public/preload.js
npm run type-check
npm run validate:git-commits
npm run validate:git-workspace
npm run validate:process-results
npm run build
```

手动检查：非 Git 项目初始化、无 upstream 分支发布、普通/初始/merge HEAD 的撤销、amend、成功及冲突的 cherry-pick/revert、冲突后的外部工具提示，以及主仓库/linked worktree/submodule 路由。

## Review Gates

- 每个子任务先运行其聚焦验证，再运行 `trellis-check`。
- 最后一个子任务完成后运行父任务列出的完整命令，不以单个子任务通过替代集成检查。
- 自动 abort 失败必须保留原始操作错误和 abort 错误，不能通过吞掉错误或新增隐藏恢复动作让验证通过。
