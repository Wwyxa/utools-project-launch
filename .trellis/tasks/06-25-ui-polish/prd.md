# UI 观感与视觉层次提升

## Goal

用户反馈插件 UI"有点简陋"。经代码调研，底层设计系统并不薄弱（完整的 Material You 语义化 token、双主题、彩色项目图标、无障碍属性俱备），"简陋感"主要来自三个层面：首页首屏缺乏应用感与信息锚点、各功能页视觉层次单调且一致性不足、加载态两极分化（部分页面骨架屏、部分页面纯文本空白）。

本父任务统领三方向改进，目标是让插件从"工具面板"观感升级为"完成度高的应用"，同时不破坏现有功能与交互。

## 调研结论（规划依据）

- **设计系统底子好**：[src/index.css](src/index.css) 有完整语义 token、浅色/深色双主题、状态色体系；字体 Inter + JetBrains Mono。
- **首页缺锚点**：[Dashboard.vue](src/components/dashboard/Dashboard.vue) 一进来直接是搜索框 + 卡片网格，无标题、无概览统计带、无品牌区。
- **空状态单薄**：首页空状态仅虚线框 + 一行字 + 一个按钮。
- **卡片信息过密**：[ProjectCard.vue](src/components/dashboard/ProjectCard.vue) 单卡塞入图标/名称/徽章/描述/路径/脚本/时间/5 个悬停操作，字号低至 `text-[10px]`，层次只靠灰度区分。
- **一致性缺口（高 ROI）**：
  - [FilesTab.vue](src/components/project/FilesTab.vue) 大量英文硬编码未走 i18n（`Loading...`、`No files.`、`Select a file to preview.`、`Find`/`Replace`/`Edit`/`Saved` 等）。
  - [Terminal.vue](src/components/terminal/Terminal.vue) 大量 `dark:` slate 硬编码绕开语义 token，暗色主题不统一。
  - 圆角 `rounded`/`rounded-lg`/`rounded-full` 在多数组件混用，无明确规则。
  - 各页 header 样式各自为政，缺统一"卡片头"规范。
- **加载态两极分化**：[EnvironmentTab.vue](src/components/environment/EnvironmentTab.vue) 是骨架屏黄金标准（`animate-pulse` 占位条 + `aria-busy`）；FilesTab/ScriptsTab/MemoTab 基本无加载态，FilesTab 尤其廉价（纯文本 `Loading...`）。
- **数据可用**：store 的 `availableProjects`、各 script `status`、`gitLatestCommitAt`、`git.ahead/behind/files` 足以聚合出概览带所需指标。

## 设计约束

- **不引入新依赖**：复用现有 Vue 3 + Tailwind 4 + lucide-vue-next + index.css token 体系。
- **不改数据契约**：不改 store 的持久化结构、不改 preload/bridge 接口；新增仅限 UI 层（i18n 文案、CSS 类、组件内渲染）。
- **保留现有交互**：拖拽排序、ResizeObserver 脚本按钮测量、键盘 Escape 退出、卡片悬停操作等已有行为不动。
- **双主题一致**：所有改动必须在浅色/深色下都成立，优先用语义 token，禁止新增 `dark:` 硬编码色板（Terminal 的硬编码应被消除而非扩散）。
- **可访问性不退化**：新增徽标/统计带需带 `aria-label`/语义标签；加载态用 `aria-busy`。
- **i18n 对齐**：所有新增/修改的可见文案必须在 `zh-CN` 与 `en-US` 两个 locale 块中 key 完全对齐（`as const` 会强制类型检查）。

## 任务地图（子任务边界）

| 子任务 | 范围 | 主要文件 |
| --- | --- | --- |
| [06-25-dashboard-first-impression](../06-25-dashboard-first-impression/prd.md) | 首页首屏应用感：概览统计带、空状态重做、卡片信息层次优化 | Dashboard.vue、ProjectCard.vue、index.css、i18n.ts |
| [06-25-visual-hierarchy](../06-25-visual-hierarchy/prd.md) | 视觉层次与一致性：统一卡片头规范、圆角 token 规则、详情页/设置页区块分层、FilesTab 国际化、Terminal token 统一 | 各 Tab、Terminal.vue、SettingsTab.vue、ProjectDetails.vue、index.css、i18n.ts |
| [06-25-loading-polish](../06-25-loading-polish/prd.md) | 加载与质感：抽可复用骨架屏、补 FilesTab/GitTab 加载态、模态/面板进场过渡、运行态脉动统一 | index.css、FilesTab.vue、GitTab.vue、ScriptsTab.vue、各模态 |

### 执行顺序与依赖

- **子任务1（首页观感）优先实施**：用户最关心、首屏影响最大、文件相对独立。
- 子任务2 涉及统一卡片头类，会触及多个 Tab；建议在子任务1 完成后进行，避免与卡片层次改动冲突。
- 子任务3 的骨架屏抽象会复用 EnvironmentTab 既有实现，与子任务2 改 Terminal/Files tab 有文件交集，建议在子任务2 之后或与其协调。
- 子任务2 与子任务3 在 FilesTab/GitTab 上有文件重叠，实施时按"先一致性（文案/token/层次）→ 再加载态"的顺序在同一文件内推进，避免反复改同一文件。

## 跨子任务验收标准

- [ ] 首页打开即有"应用感"：可见概览统计带（项目数/运行中/有改动等），不再是纯搜索框起手。
- [ ] 全程无英文硬编码可见文案（FilesTab 等已国际化），暗色主题下无 slate 硬编码色板残留。
- [ ] 加载场景无纯文本空白：文件树、文件内容、diff、Git 刷新均有骨架屏或统一加载指示。
- [ ] 浅色/深色双主题下视觉一致，无新增 `dark:` 硬编码色值。
- [ ] 圆角、卡片头、间距在跨组件层面呈现统一规则，无"一列完全相同的盒子"观感。
- [ ] 现有功能（启动/停止脚本、Git 操作、拖拽排序、文件编辑、AI 分析、导入导出）全部回归通过。
- [ ] `npm run lint`（tsc --noEmit）通过；i18n 两 locale key 对齐无类型错误。

## Notes

- 父任务不直接实施；每个子任务独立 prd/design/implement，独立 start、检查、归档。
- 子任务2、3 的 design.md/implement.md 在其各自 start 前补齐（先规划实施子任务1）。
- 视觉方案为推荐方案，具体定稿在各子任务 design.md 的 review gate 由用户确认。
