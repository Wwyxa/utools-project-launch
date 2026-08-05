# 修正与撤销最近提交 - Implementation Plan

## Checklist

- [ ] 扩展 `ProjectGitActionBlockReason`、`ProjectGitActionResult.commitMessage` 和 `ProjectBridge` 方法；同步 browser fallback。
- [ ] 在 preload 实现 attached HEAD/父提交/message 读取与 `amendGitCommit`。
- [ ] 在 preload 实现普通、merge 和 root HEAD 的 `undoLastGitCommit`，包括 root 路径失败回滚。
- [ ] 先扩展 `scripts/validate-git-commits.mjs` 验证真实 Git 状态转换和无数据丢失。
- [ ] 在 Store 增加 target-aware actions，使用 full refresh、ref invalidation 和失败后必要刷新。
- [ ] 扩展 workspace tests，验证路径授权、bridge 参数、草稿结果和刷新。
- [ ] 在 `GitChangesPane.vue` 增加 More 菜单、amend mode、确认及撤销动作；保持提交草稿由父组件协调。
- [ ] 验证普通 commit、stash、stage/unstage/discard 和 repository 切换没有回归。

## Focused Validation

```bash
node --check public/preload.js
npm run validate:git-commits
npx vitest run tests/projectBridge.workspace.test.ts
npm run type-check
npm run build
```

## Risk And Rollback Points

- root commit 撤销必须先通过真实临时仓库测试；若恢复路径不可靠，停止实现并回到设计，不以 hard reset 或删除工作区文件替代。
- amend 草稿切换只保存在组件当前会话；若 context 切换泄漏，先修复 generation/context cleanup，不把 UI 状态移入持久化。
- 不把 amend 合并进 `commitGitStaged` 的隐式 option；若共享代码需要复用，仅抽取 preload 内部的小型提交验证 helper。
