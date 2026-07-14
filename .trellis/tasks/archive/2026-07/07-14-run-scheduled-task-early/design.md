# 提前执行计划条目：技术设计

## Architecture And Boundaries

本功能保持现有三层职责：

1. `AutomationTab.vue` 和 `Dashboard.vue` 展示计划条目、收集用户选择并显示操作反馈。
2. Pinia store 校验项目、任务和目标条目是否仍可提前执行。
3. 现有 `runAutomationTask(projectId, taskId, entryId)` 继续负责状态流转、脚本串行执行、历史、通知和持久化。

不新增或修改共享类型，不改变计划生成、序列化或存储格式。

## Data Flow And Contracts

```text
未来 pending 条目的提前执行按钮
  -> runAutomationPlanEntryEarly(projectId, taskId, entryId)
  -> 校验当天条目仍为 pending 且 plannedAt > 当前时间
  -> 校验任务有脚本且同项目无活动自动化运行
  -> runAutomationTask(projectId, taskId, entryId)
  -> 原条目 pending -> running -> completed/failed/skipped
  -> 原 plannedAt 写入历史，定时器不再选择该条目
```

新增 store action 返回 `boolean`：成功接受执行请求时为 `true`；项目、任务或条目不存在，条目不再是未来待执行状态，任务无脚本，或同项目已有活动运行时为 `false`。失败不得改变计划和历史。

组件只对当天、未来、`pending` 的条目显示提前执行按钮。任务自身正在运行或没有脚本时按钮禁用；不因同项目兄弟任务运行而静默禁用，以便点击后展示已有的“同项目任务运行中”反馈。

首页任务概览的 `upcomingAutomationTasks[].nextEntry` 是当天计划中的原始条目对象。首页直接把其 `id` 传给同一个 store action，不创建第二套执行逻辑或状态模型。

## UI Design

- 在每个符合条件的计划时间状态胶囊内加入 `Play` 图标按钮，保留时间和状态的紧凑布局。
- 首页“下次执行”列表的每一行加入同一 `Play` 图标按钮。由于 HTML 不允许按钮嵌套，原整行按钮改为具备 `role="button"`、`tabindex="0"` 和 Enter/Space 导航行为的行容器，内部提前执行按钮使用 `@click.stop`。
- 图标按钮使用独立的本地化 `title` 与 `aria-label`，名称为“提前执行”/“Run early”。
- 操作结果使用任务列表区域内的面板级反馈，不复用只在编辑弹窗中展示的表单错误状态。
- 首页入口复用任务概览弹窗现有的 `automationOverviewFeedback`，成功与项目并发冲突均在弹窗内可见。
- 成功与冲突反馈复用现有“任务已开始执行”及“同项目已有任务正在运行”文案。
- 不增加确认弹窗；现有任务级“立即执行”按钮和行为不变。

## Edge Cases

- 点击与计划到点发生竞态：store 在动作入口重新检查 `plannedAt > Date.now()`，已到期条目拒绝提前执行并交给正常调度。
- 快速重复点击：第一次执行会同步把条目标记为 `running` 并登记项目活动运行，后续请求被拒绝。
- 定时执行关闭：允许显式提前执行，与现有手动立即执行约定一致。
- 条目已完成、失败、跳过、错过或正在运行：不展示提前执行入口，store 仍会拒绝过期调用。
- 同项目其他任务运行：store 拒绝且组件显示冲突反馈。

## Compatibility And Rollback

没有数据迁移或持久化契约变化。回滚时删除组件入口、本地化键和 store action 即可；已有计划与历史数据不受影响。
