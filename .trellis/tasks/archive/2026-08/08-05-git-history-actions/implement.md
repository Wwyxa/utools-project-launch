# 应用与回退历史提交 - Implementation Plan

## Checklist

- [ ] 扩展 shared blocker union 和 `ProjectBridge` cherry-pick/revert 方法；同步 browser fallback。
- [ ] 在 preload 实现普通提交、attached branch、clean worktree 和 operation-state 验证。
- [ ] 实现单提交 cherry-pick/revert 及 matching conflict auto-abort，通过普通失败结果报告操作与 abort 结果。
- [ ] 扩展真实仓库 validation，先证明成功、拒绝、冲突恢复和 abort-failure 状态。
- [ ] 在 Store 增加 target-aware actions，失败也 full refresh 并失效 refs。
- [ ] 扩展 workspace tests，验证正确仓库路径、刷新和 stale target 拒绝。
- [ ] 在 `GitCommitHistory.vue` context menu 增加两个动作、确认和普通失败 warning dialog。
- [ ] 为 cherry-pick/revert 失败提供固定的纯文案提示，说明外部应用配置与现有仓库菜单路径，不调用 Store 外部应用 action。
- [ ] 验证现有 checkout、branch/tag、stash、AI selection 和菜单键盘行为没有回归。

## Focused Validation

```bash
node --check public/preload.js
npm run validate:git-commits
npx vitest run tests/projectBridge.workspace.test.ts
npm run type-check
npm run build
```

## Risk And Rollback Points

- 冲突 fixture 必须断言 HEAD、index 和 worktree 内容，不以 `CHERRY_PICK_HEAD` 消失作为唯一恢复证据。
- abort 失败必须返回普通失败结果并保留原始操作错误和 abort 错误；不得继续尝试 reset/clean 或隐藏仓库状态。
- 不把现有 AI 多选接入写操作；如果单提交菜单变拥挤，调整分组/分隔线，不新增批量工具栏。
