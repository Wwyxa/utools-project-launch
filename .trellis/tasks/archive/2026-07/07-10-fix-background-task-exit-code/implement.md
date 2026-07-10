# 实施计划

## Implementation

- [x] 读取 frontend/backend Trellis 规范，确认 preload 桥接与 Pinia store 的约定。
- [x] 在桥接 payload 和进程结果类型中增加可选 `automationRunId`，浏览器 fallback 同步签名。
- [x] 将自动化外层 `runId` 从 `runAutomationTask()` 传入每个 `runAutomationScript()` 和 `launchScript()`，移除无用途的内部 runId。
- [x] 将 preload 最近脚本结果缓存替换为 `projectId + scriptId + automationRunId` 的精确批次缓存；手动运行不写入该索引。
- [x] 将恢复 API 改为按自动化批次查询，并在 `reconcileOrphanedAutomationRuns()` 中强制使用计划条目的 `runId`。
- [x] 调整项目加载顺序，等待旧运行恢复完成后再计算和启动到期计划。
- [x] 为状态恢复增加共享 Promise，合并初始化、focus 和 visibility 的并发调用。
- [x] 新增进程结果批次关联验证脚本及 package 命令，覆盖成功/失败互不覆盖、手动运行隔离、多脚本批次和缺失精确结果。
- [x] 先增加输出匹配停止后原始 `4294967295` 的失败回归用例，覆盖 preload 缓存与真实 store 恢复。
- [x] 为 bridge 停止选项、事件和完成结果增加 `automationExitMatched` 类型契约。
- [x] 仅在输出匹配成功路径携带当前 `automationRunId` 请求停止，并由 preload 校验活动进程身份后缓存该语义。
- [x] 统一实时与恢复成功判定，保留手动停止、超时和真实非零退出失败行为。
- [x] 重跑聚焦、类型、preload 语法、存储兼容和生产构建验证。

## Focused Validation

```powershell
npm run validate:process-results
npm run type-check
```

## Full Validation

```powershell
npm run validate:project-storage
npm run validate:ai-reasoning
npm run type-check
npm run build
```

## Review Gates

- [x] 搜索确认不再存在仅按 `projectId + scriptId` 查询自动化完成结果的路径。
- [x] 审查所有 `launchScript()` 调用方，确认只有自动化运行携带 `automationRunId`。
- [x] 审查旧运行无精确结果时只会 `skipped`，不会猜测成功或失败。
- [x] Trellis `trellis-check` 子代理完成全范围检查并修复相关问题。
- [x] Trellis `trellis-check` 子代理复查第二根因及新增回归覆盖。

## Risk And Rollback Points

- 桥接 API 改名或增参必须同步 preload、全局类型、真实 bridge 和浏览器 fallback，否则插件加载时会出现运行时不匹配。
- 加载顺序变化可能影响错过计划策略，验证时需确认恢复完成后调度计时器仍正常建立。
- 恢复互斥不得吞掉后续请求；共享 Promise 必须在成功或失败后清理。
