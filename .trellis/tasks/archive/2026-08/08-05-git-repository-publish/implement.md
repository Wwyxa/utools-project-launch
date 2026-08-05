# 初始化与发布 Git 仓库 - Implementation Plan

## Checklist

- [ ] 在 `src/types.ts` 的 `ProjectBridge` 中加入初始化和发布方法；同步 browser fallback typed failures。
- [ ] 在 `public/preload.js` 实现 `initializeGitRepository`，验证目录并使用 argv 运行 `git init`。
- [ ] 在 `public/preload.js` 实现异步 `publishGitBranch`，复用 remote 校验、超时和非交互认证约束。
- [ ] 扩展 `scripts/validate-git-commits.mjs`，先验证真实 Git 初始化与本地 bare remote 发布行为。
- [ ] 在 `src/store/useStore.ts` 加入初始化特例的写锁/缓存清理/刷新，以及 repository-target-aware 发布 action。
- [ ] 扩展 `tests/projectBridge.workspace.test.ts`，验证主路径初始化、目标仓库发布、刷新与 stale target 拒绝。
- [ ] 在 `GitTab.vue` 增加紧凑初始化入口，并让 push 入口在无 upstream 时进入单/多 remote 发布确认。
- [ ] 检查现有 fetch/pull/push、remote 增删改和 repository 切换没有回归。

## Focused Validation

按实现层级循环运行最小检查：

```bash
node --check public/preload.js
npm run validate:git-commits
npx vitest run tests/projectBridge.workspace.test.ts
npm run type-check
npm run build
```

## Risk And Rollback Points

- 初始化成功后的缓存清理是独立风险点；若 snapshot 仍显示 no-repo，先修正 Store 刷新顺序，不在组件伪造状态。
- 发布必须保持 async remote helper；若测试困难，不得退回同步 `spawnSync`。
- 多 remote 选择应扩展现有 popover；若布局不稳，回退该 UI 改动并保留 bridge/store，不新增第二套 remote dialog。
