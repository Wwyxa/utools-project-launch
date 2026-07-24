# 统一 UI 偏好与拖拽提示状态 - 实施计划

## 实施顺序

- [x] 1. 在 `src/types.ts` 增加 `ProjectDetailsTabId`、`UiPreferences`，并将 ProjectBridge 契约替换为统一 UI 偏好读写方法。
- [x] 2. 在 `src/lib/projectBridge.ts` 增加默认值、规范化、新键读写和旧数组迁移；保留浏览器 fallback 的旧键兼容写入。
- [x] 3. 增加聚焦的 UI 偏好测试，覆盖默认值、旧默认/非默认顺序迁移、损坏数据、去重补齐和读写往返。
- [x] 4. 在 `public/preload.js` 实现同构的 `dbStorage` 读取、迁移和保存逻辑，并暴露新 bridge 方法。
- [x] 5. 在 `src/store/useStore.ts` 将 Tab 顺序状态替换为初始化时一次加载的 `uiPreferences`，增加排序更新和 Coach Mark 确认 action，避免 `loadProjects()` 重复读取。
- [x] 6. 在 `src/components/project/ProjectDetails.vue` 改为读取 Pinia Coach Mark 版本，并在长按阈值触发时确认提示；移除模块会话标记。
- [x] 7. 搜索并删除旧 bridge 方法的全部引用，确认双语提示文案继续使用且无孤立键。
- [x] 8. 运行聚焦测试、全量测试、lint、type-check、build 和 uTools preload 语法检查。
- [x] 9. 完成浏览器交互回归和 uTools 插件重启回归。

## 首次编辑后的聚焦验证

在完成类型与 browser bridge 的第一组实质编辑后立即运行：

```bash
npx vitest run src/lib/projectBridge.uiPreferences.test.ts
```

若测试尚未创建，先运行：

```bash
npm run type-check
```

不得在首次编辑和该验证之间继续扩大修改范围。

## 最终验证

```bash
npx vitest run src/lib/projectBridge.uiPreferences.test.ts
npm run lint
npm run build
node --check public/preload.js
```

浏览器手动验证：

1. 清空新旧 UI 偏好键并刷新，确认提示显示。
2. 短按 Tab，确认提示仍显示。
3. 长按达到阈值但不换位，确认提示隐藏、返回重开仍隐藏、顺序未变化。
4. 整页刷新，确认提示仍隐藏。
5. 重置存储后长按换位，确认顺序与提示状态同时持久化。
6. 注入旧默认/非默认顺序，分别确认提示显示/隐藏及迁移结果。
7. 在 520px 与 1280px 视口确认提示不挤压 Tab、窄屏仅显示图标。

uTools 手动验证：

1. 完全关闭并重新打开插件，确认已确认的提示不再出现。
2. 调整 Tab 顺序后重启插件，确认顺序保持。

## 风险与回滚点

- Bridge 方法替换会影响 TypeScript 测试替身；以 `npm run type-check` 作为契约完整性门禁。
- preload 与 browser fallback 的规范化逻辑必须同步；用相同验证矩阵人工对照，并通过 `node --check` 防止 preload 语法错误。
- 保留并同步旧顺序键一个发布周期，确保回滚旧版本后仍能读取最新排序。
- 不修改项目持久化、导入导出或设备可见性代码；出现异常时可独立回滚 UI 偏好相关五个应用文件。

## 审阅门禁

- [x] PRD、设计和实施计划经用户确认。
- [x] `implement.jsonl` 与 `check.jsonl` 至少各有一条真实规范/研究上下文。
- [x] `task.py start` 成功后才进入实现。
- [x] 实现完成后使用 `trellis-check` agent 验证，不在 agent 中提交。

## 实施记录

- 2026-07-24：统一 UI 偏好契约、旧顺序迁移、Pinia 单次加载和有效长按确认已实现。
- 2026-07-24：`npx vitest run` 通过（5 个文件、41 项测试）；`npm run lint`、`npm run type-check`、`npm run build`、`node --check public/preload.js` 通过。
- 2026-07-24：按本次子代理约束未启动 `trellis-check`；浏览器与 uTools 宿主手动回归待主会话执行。
- 2026-07-24：Phase 2.2 最终审查确认有效长按未换位只确认一次，短按/阈值前移动取消不确认，排序仅在变化时写入；组件无直接存储访问或 Coach Mark 第二状态源。
- 2026-07-24：补充 browser/preload 新旧配置优先级、旧数组迁移、规范化和双键同步回归测试；修复 `validate-process-result-batches.mjs` 手写 ProjectBridge 替身缺少 UI 偏好与 Store 初始化方法。
- 2026-07-24：`npx vitest run` 通过（5 个文件、46 项测试），`npm run validate:process-results`、`npm run lint`、`npm run type-check`、`npm run build`、`node --check public/preload.js`、`git diff --check` 全部通过；浏览器与 uTools 宿主手动回归待主会话执行。
- 2026-07-24：用户手动确认有效长按后提示消失，页面刷新后不再出现；主会话复跑 46 项测试、process-results 验证、lint、build 和 preload 语法检查均通过。
