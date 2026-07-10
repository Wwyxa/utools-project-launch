# 后台自动化进程结果批次关联设计

## Problem Boundary

自动化计划使用外层 `runId` 标识一次任务运行，但进程桥接层只知道项目和脚本。preload 因此只能保存“某脚本最近一次完成结果”，恢复孤儿运行时再用结束时间猜测归属。只要同一脚本被再次运行，旧计划就可能消费错误结果。

退出码 `4294967295` 是有效的 Windows `-1` 失败码。本修复不改变退出码语义，只修复结果归属。

## Data Contract

一次自动化脚本启动携带可选字段 `automationRunId`：

1. `runAutomationTask()` 生成并写入计划条目的外层 `runId`。
2. `runAutomationScript()` 将该值传给 `launchScript()`。
3. `launchScript()` 将其加入 `ProjectBridgeRunCommandPayload`。
4. preload 将其保存在活动进程元数据和完成结果中。
5. 自动化完成结果只在 `automationRunId` 存在时写入批次索引。
6. 恢复查询必须提供 `projectId + scriptId + automationRunId`。

手动脚本不携带 `automationRunId`，仍保留 PID 状态查询和普通事件处理，但不参与自动化恢复索引。

输出匹配成功退出使用结构化停止选项传递：

1. renderer 在 `shouldAutomationExitOnOutput()` 命中后，以当前 `automationRunId` 请求停止进程。
2. preload 仅在 PID 对应的活动进程元数据与 `automationRunId` 一致时记录 `automationExitMatched: true`。
3. close 事件、PID 完成结果和自动化批次完成结果保留该字段。
4. 实时结算和孤儿恢复统一将 `code === 0 || automationExitMatched === true` 视为脚本完成。

普通手动停止和超时停止不传该标记，真实非零退出码继续失败。

## Cache Design

将按脚本最近结果缓存替换为按自动化批次索引：

```text
projectId::scriptId::automationRunId -> completed process result
```

PID 缓存继续服务当前脚本状态恢复。批次缓存沿用容量上限，结果包含 `endedAt` 作为防御性时间校验，但时间不再承担身份关联职责。

旧数据或旧 preload 结果缺少 `automationRunId` 时返回无精确结果。孤儿计划按既有安全策略标记为 `skipped`，不得回退查询脚本最近结果。

## Recovery Order

项目加载顺序调整为：

1. 加载并规范化项目数据。
2. 恢复持久化的脚本和自动化运行终态。
3. 重新计算计划并启动新的到期任务。

运行状态恢复由共享中的 Promise 串行化。初始化、focus 和 visibility 同时触发时复用同一次恢复，避免重复结算和历史记录。

## Compatibility

- 已完成历史和非运行中计划不迁移。
- 缺少精确批次缓存的旧 `running` 条目降级为 `skipped`，避免误报成功或失败。
- 普通脚本运行、用户停止、超时、输出匹配退出和真实非零退出码语义保持不变。
- preload 与渲染层类型和 API 在同一版本同步更新。
- `stopProcess(pid)` 的既有调用保持有效；输出匹配路径通过可选停止参数补充自动化成功语义。

## Rollback

改动集中在可选 payload 字段、preload 批次缓存、store 传参与恢复顺序。若出现回归，可整体回退这些变更；持久化项目结构不新增字段，因此无需数据回滚。
