# 统一 UI 偏好与拖拽提示状态 - 技术设计

## 1. 边界与目标

本次只改造应用级 UI 偏好边界，不改变项目数据、项目导入导出格式或跨设备可见性规则。UI 偏好由 ProjectBridge 负责持久化，Pinia 负责当前渲染会话缓存，组件只调用 Store action。

## 2. 数据契约

在 `src/types.ts` 定义共享契约：

```ts
type ProjectDetailsTabId = "info" | "scripts" | "automation" | "files" | "git" | "memo";

interface UiPreferences {
  schemaVersion: 1;
  projectDetails: {
    tabOrder: ProjectDetailsTabId[];
  };
  coachMarks: {
    projectDetailsTabReorder: number;
  };
}
```

当前 Coach Mark 版本常量为 `1`。版本 `0` 表示尚未确认。使用数字而非布尔值，允许未来交互变化后提高版本并重新展示。

持久化键：

- 新键：`utools-project-launch.ui-preferences.v1`
- 旧键：`utools-project-launch.project-details-tab-order.v1`，仅用于兼容迁移

## 3. 默认值与规范化

默认 Tab 顺序为 `info, scripts, automation, files, git, memo`，默认提示版本为 `0`。

规范化必须：

- 校验 `schemaVersion` 和对象层级；缺失字段使用默认值。
- 过滤未知 Tab ID、去重，并按默认顺序补齐新增或缺失 ID。
- 将 Coach Mark 版本限制为非负整数；无效值回退为 `0`。
- 返回新数组/对象，避免持久化对象与 Pinia reactive proxy 共享引用。

浏览器 fallback 与 preload 各自实现同一逻辑，因为 `public/preload.js` 不能直接导入前端 TypeScript 模块。两端使用相同 fixtures/验收矩阵人工核对。

## 4. 迁移策略

读取顺序：

1. 读取并规范化新 `ui-preferences.v1`；存在有效对象时直接返回。
2. 新配置不存在时读取旧数组键。
3. 规范化旧顺序并写入新配置：
   - 与默认顺序不同：`projectDetailsTabReorder = 1`。
   - 与默认顺序相同或旧值无效：`projectDetailsTabReorder = 0`。
4. 保留旧键作为回滚兼容，不在本次删除。

迁移写入失败时仍返回内存中的规范化结果，不阻断应用启动。

## 5. Bridge 与 Store

将现有细粒度方法：

```ts
loadProjectDetailsTabOrder(): string[];
saveProjectDetailsTabOrder(order: string[]): void;
```

替换为统一方法：

```ts
loadUiPreferences(): UiPreferences;
saveUiPreferences(preferences: UiPreferences): void;
```

Pinia state 持有 `uiPreferences`，并提供两个意图明确的 action：

- `setProjectDetailsTabOrder(order)`：规范化/复制顺序，更新内存并保存整份 UI 偏好。
- `acknowledgeProjectDetailsTabReorderHint(version)`：仅在当前值低于目标版本时更新并保存，保证一次确认只写一次。

Store 初始化时通过 bridge 加载一次 `uiPreferences`；`loadProjects()` 和详情组件重建不再重复读取。详情组件不得直接调用 bridge 或存储 API。

## 6. 组件交互

提示显示条件：

```ts
store.uiPreferences.coachMarks.projectDetailsTabReorder < currentHintVersion;
```

在 350ms 长按计时器确认进入拖拽模式时：

1. 设置 `draggedTab`。
2. 调用 Store action 确认当前提示版本。
3. 提示通过响应式状态立即隐藏。

这一步与排序结果无关。Pointer up 时只有 `tabOrderChanged` 为 true 才保存顺序。短按或移动超出容差导致计时器取消时，不确认提示。

删除当前 `<script>` 模块变量 `showTabOrderHintInSession` 和组件本地 `showTabOrderHint`，避免存在第二真相源。

## 7. 性能

- 持久化读取：Store 初始化时一次，不随 `loadProjects()` 或详情页打开次数增长。
- 详情页判断：一个 Pinia 数字比较，O(1)。
- 规范化 Tab 顺序：固定 6 个元素，启动时 O(n)。
- Coach Mark 写入：每个提示版本最多一次；排序写入仍只在顺序变化时发生。

## 8. 兼容与回滚

- 新版本保留旧键，旧应用回滚后仍可读取最后一份旧顺序。
- 新版本保存顺序时可继续同步旧顺序键一个发布周期，确保回滚不丢失用户最新排序；该兼容写入应在设计实现时保持集中于 bridge/preload。
- 若统一配置读取失败，回退默认 UI 偏好，不影响项目数据。
- 回滚代码只需恢复旧 bridge 方法和组件会话提示；新键可保留，不影响旧版本。

## 9. 验证矩阵

- 无任何存储 -> 默认顺序、提示显示。
- 旧默认数组 -> 默认顺序、提示显示、新配置完成迁移。
- 旧非默认数组 -> 保持顺序、提示隐藏、新配置完成迁移。
- 新配置提示版本 1 -> 插件重启后提示隐藏。
- 有效长按但未换位 -> 提示版本写入 1，顺序不写入。
- 短按/长按前移动取消 -> 提示版本保持 0。
- 损坏 JSON、未知/重复 Tab、负数/小数版本 -> 安全规范化。
- 浏览器返回重开、整页刷新以及 uTools 插件重启 -> 行为符合 PRD。
