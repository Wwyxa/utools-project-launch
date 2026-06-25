# 加载与质感 · 技术设计（design.md）

> 父任务：[06-25-ui-polish](../06-25-ui-polish/prd.md) ｜ 本任务 PRD：[prd.md](./prd.md)

## 0. 与上游约束对齐

- 遵循父 PRD 工程约束：复用 `src/lib/time.ts` 时间格式化（本任务不涉及时间显示，故大概率不调用）；TS `enum` 运行时使用须值导入（本任务不新增 enum 使用）；i18n 两 locale key 对齐（`as const` 不查死 key，需手工保持对齐）；双主题只用语义 token，**不新增** `dark:` 硬编码色板；`npm run lint`（`tsc --noEmit`）+ `npm run build` 为验收门槛。
- 遵循前端 spec：`quality-guidelines.md` 禁止「硬编码颜色当 `src/index.css` 已有语义 token」「顺手复制类串而不抽取共用模式」「图标按钮缺无障碍名」；`component-guidelines.md` 要求语义 token、`cn` 组合、scoped CSS 仅用于难以用工具类表达的小过渡。
- 沉淀约束（`/memories/repo/utools-project-launch.md`）：`.ui-panel-header/.ui-panel-title/.ui-panel-meta` 已固化、GitTab padding 三桶、Terminal 已无 `dark:`（勿再引入）、同文件多编辑用 `multi_replace_string_in_file` 顺序应用，**勿对同一文件并行多个 replace_string 调用**（本会话 FilesTab 曾因此损坏模板）。
- 子任务1（首页观感）的「首页顶部概览统计带」已被用户否决回退，本任务不触碰 `Dashboard.vue` 顶部统计。
- 子任务2（visual-hierarchy，已归档）已落地 `.ui-panel-header` 卡片头、GitTab padding 三桶、Terminal `dark:` 清零、FilesTab 国际化、ProjectDetails 概览重构、SettingsTab 区块分层。本任务改 `FilesTab.vue` / `GitTab.vue` 时须**沿用其既定 token / padding / i18n 规范**，不回退。

## 1. 骨架屏抽象（形态由 Review Gate A 定）

### 1.1 现状（EnvironmentTab 是黄金标准，其余纯文本）

| 文件 · 位置 | 现状 | 问题 |
| --- | --- | --- |
| `EnvironmentTab.vue` L27/L109/L117–145 | `showInitialSkeleton` computed → section `:aria-busy`，内层 placeholder 卡片用 `h-3 w-XX animate-pulse rounded bg-surface-container-high` 三条占位 + "checking" 药丸(`RefreshCw animate-spin`) | 形态最完善，但骨架类串 `animate-pulse rounded bg-surface-container-high` 在文件内逐条重复，**未抽取** |
| `FilesTab.vue` L649 | `<div v-if="isLoadingTree" class="p-2 text-on-surface-variant">{{ t.files.loading }}</div>` | 纯文本 `Loading...` |
| `FilesTab.vue` L837 | `<div v-if="isLoadingFile" class="p-6 text-sm text-on-surface-variant">{{ t.files.loading }}</div>` | 纯文本 `Loading...`；位于代码区，视觉空白大 |
| `FileTreeNode.vue` L112 | `<span v-if="node.loading" class="ml-auto shrink-0 text-[10px] text-on-surface-variant">...</span>` | 子目录展开瞬间 `...` 纯文本 |
| `GitTab.vue` L2720 | `<div v-if="isLoadingDiff" class="p-5 text-sm text-on-surface-variant">{{ t.git.diffLoading }}</div>` | diff 读取消现在纯文本 |
| `GitTab.vue` L2856 | `<p v-if="isLoadingCommitFiles" class="text-xs text-on-surface-variant">正在读取变更文件...</p>` | 提交详情文件列表**硬编码中文**未走 i18n，且是纯文本 |

> Terminal 光标 `<div class="animate-pulse text-primary mt-1">_</div>`（L286）属终端光标而非加载态，**不在本任务改造范围**。

### 1.2 抽象形态（Gate A 候选）

- **A1（推荐）全局 CSS 工具类 `.skeleton`**：在 `src/index.css`（接现有 `.ui-panel-header` 等附近，统一风格）新增：
  ```css
  /* 骨架占位条：动画+底色+圆角统一定义，宽高由各处 w-*/h-* 叠加 */
  .skeleton {
    @apply animate-pulse rounded bg-surface-container-high;
  }
  ```
  - 复用 Tailwind `animate-pulse` + 现成语义色 `surface-container-high`，与 EnvironmentTab 既有写法同源；`rounded` 默认 0.25rem 与现状一致。
  - 各加载点用 `.skeleton h-3 w-XX` 组合，宽高/缩进由 per-spot 工具类决定（挂载即脉动，无需 JS）。
  - EnvironmentTab 既有三条 `h-3 w-XX animate-pulse rounded bg-surface-container-high` 收敛改写为 `.skeleton h-3 w-XX`（形态不变，唯一变化是共用类），证明可复用性。
  - 不引入新组件文件、不动 import、零运行时成本；天然双主题（`surface-container-high` 在 `.dark` 内已被改色）。
- **A2 轻量组件 `Skeleton.vue`**：单 props（`width?`/`height?`/`rounded?`）+ 各 Tab 再封装 `SkeletonTree/SkeletonCode/SkeletonDiff`。优点：组装块语义化。缺点：树/代码/diff/提交文件四套形状差异大（树有缩进、代码对齐等宽行、diff 是 `grid-cols-[3.25rem_1fr]` 网格、提交文件是药丸+路径行），通用组件需大量 props，比内联标记更绕、更难直观调整。
- **A3 两者**：`.skeleton` 基类 + 为 >3 处复用的形状（如「药丸+路径」文件行）单独抽小组件。当前各处形状都仅本处用，暂无第 4 处驱动，A3 收益不足以抵额外组件文件。
- **默认建议 A1**：单一 `.skeleton` 基类 + 各加载点内联骨架标记。形态最贴现状、改进即验证可复用、不增加文件与 import 复杂度。若用户更看重组件化语义则转 A2/A3。

### 1.3 各加载点落地形态（基于 A1）

- **FilesTab 文件树（L649）**：`isLoadingTree` 时渲染 8 行骨架行取代纯文本。每行 = 缩进槽（`ml-3/6/9` 随行错落）+ `.skeleton h-3 w-24/28/20` 骨架条；`div` 容器 `:aria-busy="isLoadingTree"`，`role="status"`。
- **FilesTab 文件内容（L837）**：`isLoadingFile` 时在代码区渲染 ~12 行骨架代码行：外层 `aria-busy`；每行 `grid-cols-[3rem_1fr]`（与 `file-code-surface` gutter 对齐）左 gutter 骨架 `.skeleton h-2.5 w-6` + 内容 `.skeleton h-2.5 w-full`（宽度 `w-72/w-96/w-64` 等错落，`font-mono text-xs leading-5`），保留代码面观感。
- **FileTreeNode 子目录展开（L112）**：将 `...` 文本改为右侧 `.skeleton h-2.5 w-10` 小条（隐含脉动），与行内对齐。
- **GitTab diff（L2720）**：`isLoadingDiff` 时在 diff 滚动体内渲染 ~10 行骨架 diff：每行 `grid-cols-[3.25rem_minmax(0,1fr)]`（与真实 diff 行网格一致）gutter `.skeleton h-3 w-8` + 内容 `.skeleton h-3 w-full`（宽度错落）；区容器 `:aria-busy="isLoadingDiff"`。
- **GitTab 提交详情文件列表（L2856）**：`isLoadingCommitFiles` 时渲染 4–6 行骨架：每行药丸位 `.skeleton h-4 w-8` + 路径位 `.skeleton h-3 w-48/60`；删除硬编码中文 `正在读取变更文件...`（无 i18n key 待清）。
- **i18n 清理**：`t.files.loading`（现仅 FilesTab L649/L837 两处使用，皆改骨架后失用）与 `t.git.diffLoading`（现仅 GitTab L2720 一处使用，改骨架后失用）在两 locale 同步删除，避免孤儿 key（`as const` 不查死 key，须手工保对齐）。提交详情 `正在读取变更文件...` 为字面量，无 key。
- **可访问性**：所有骨架区容器加 `aria-busy="true"`（与 EnvironmentTab 一致）取代可见文本；无障碍朗读「正忙」即可。不新增可见文本，故不需要新 i18n。

## 2. 进场过渡（范围由 Review Gate B 定）

### 2.1 现状（模态硬切；过渡类已有 fade / slide-up）

- `src/index.css` 末尾已有 `/* Vue transition: fade */`（opacity 0.2s）与 `/* Vue transition: slide-up */`（toast 用，translateY）。
- `src/App.vue` `<style scoped>` 另定义 `.fade`（opacity 0.2s + `translateX(10px)`），仅作用于 App.vue 模板内 Tab 切换（scoped 不外溢）；GitTab/ScriptsTab 等用 `name="fade"` 实际命中 index.css 全局版（opacity 单动画），二者互不冲突。
- `GitTab.vue` L1867 已用 `<Transition name="slide-up">` 包全局加载 toast（`showGlobalLoadingBar`），证明 `<Transition>` + Teleport/弹层做法在本仓可行。
- GitTab 四个模态框当前**纯 `v-if` 硬切**：① AI 对话框 `v-if="isAiDialogOpen"`（~L2585，`fixed inset-0 z-50`）② diff `v-if="isDiffDialogOpen"`（~L2693，`z-[60]`）③ 提交详情 `v-if="isCommitDetailOpen && selectedCommit"`（~L2746，`z-50`）④ 确认框 `<Teleport to="body">` + `v-if="confirmationDialog"`（L2965–2967，`z-[80]`）。
- 同模板门户弹层另两处：`ProjectFormModal.vue` `<Teleport to="body">` + `v-if="store.projectFormOpen"`（L83–84，`fixed inset-0 z-50`）；`App.vue` 删除确认 `<Teleport to="body">` + `v-if="store.pendingDeleteProject"`（~L163–165）。父 PRD 述「模态/面板进场过渡」泛指应用模态，是否一并纳入由 Gate B 定。

### 2.2 新增命名过渡类（最小集）

在 `src/index.css` 接 `fade` / `slide-up` 段处新增（仅 `scale`；其余复用既有类）：

```css
/* Vue transition: scale (modal / dialog entry) */
.scale-enter-active,
.scale-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.scale-enter-from,
.scale-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
```

- 作用根为 `fixed inset-0 flex items-center justify-center` 遮罩+居中容器：背景 fade、面板自 viewport 中心 `scale(.96)→1`，进场与退场一致（180ms），无感知延迟。
- 备选 `slide-fade` 不新增：现存 `fade`（面板折叠/控钮 fade）与 `slide-up`（toast）已覆盖其余位置，无第二个垂直滑移目标，避免写出未用 CSS。

### 2.3 落地映射

- **GitTab 四模态**（务必做）：分别在 `isAiDialogOpen` / `isDiffDialogOpen` / `isCommitDetailOpen && selectedCommit` / `confirmationDialog` 根 `<div>` 外包 `<Transition name="scale">`。确认框处于 `<Teleport to="body">` 内，写法为 `<Teleport><Transition name="scale"><div v-if="confirmationDialog">…</div></Transition></Teleport>`（Transition 可在 Teleport 内包 v-if，单子合法）。
- **ProjectFormModal / App 删除确认**（Gate B）：同套路包 `<Transition name="scale">`；二者亦在 Teleport 内。
- **面板折叠**：
  - GitTab 浮动折叠控钮 `v-if="!collapsedGitPanel"`（~L1961）与 ScriptsTab `v-if="showScriptsCollapseControls"`（L171）等浮钮 → `<Transition name="fade">`（低风险）。
  - GitTab 半面板内容切替（`v-if="isGitFilesPanelCollapsed"` 展开钮 ↔ `v-else` 正常面板；图表面板对称）与 ScriptsTab 双/单布局切替 → keyed `<Transition name="fade" mode="out-in">` 交叉淡入**仅作可选项**：因切挂 `ResizeObserver`（FilesTab/GitTab 拖拽分隔），先在手动回归确认无割裂/无 resize 闪退；如不稳则回退为不做此点（仅浮钮 fade 即满足「无硬切」最低要求），并据此收紧验收。设计上倾向**先不加**重型半面板切换，待手动回归再判。

> **Review Gate 项 B**：进场过渡范围——① 仅 GitTab 四模态（PRD 字面）② GitTab 四模态 + ProjectFormModal + 删除确认（父 PRD「应用模态」语义，全应用模态观感统一）。默认建议 ②（一致性），需用户确认。

## 3. 运行态脉动统一（ScriptsTab）

### 3.1 现状

- 终端态点（`Terminal.vue` L199–201）：`RUNNING` → `bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]`；`STOPPING` → `bg-status-warning animate-pulse`。
- 仪表卡片态点（`ProjectCard.vue` L376）：`RUNNING` → `bg-status-running animate-pulse`（已脉动）。
- **ScriptsTab 脚本行状态药丸（`ScriptsTab.vue` L121–128）**：RUNNING 仅为 `bg-status-running/10 text-status-running border-status-running/20` 纯色药丸，**无脉动、无态点**——与终端/卡片层「运行中」观感断层。

### 3.2 方案

- ScriptsTab RUNNING 药丸前置一个态点：`<span v-if="script.status==='RUNNING'" class="mr-1 h-1.5 w-1.5 rounded-full bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]" />`，与终端态点同款 glow，药丸文字保持静止（不脉动文字）。其余状态药丸不变（最小改动，仅补 RUNNING 的「呼吸感」）。
- 不动 ProjectCard/Terminal（已统一）。RUNNING 在「仪表卡片 · 终端态点 · 详情脚本行」三层同步呼吸。

## 4. 双主题 / 可访问性 / 性能

- **双主题**：`.skeleton` 用 `surface-container-high`（已在 `.dark` 改色）、`.scale-*` 只动 opacity/transform、ScriptPulse 用 `status-running` + 透明度叠层；**无新增 `dark:` 硬编码**。手动回归须浅色/深色双走逐弹层逐加载点。
- **可访问性**：骨架区 `aria-busy` 取代可见 `Loading` 文本（对齐 EnvironmentTab）；模态根若 `role="dialog"` 已有则保留；`scale` 动画对 `prefers-reduced-motion` 无显式抑制（脉动/淡入轻量，与现有 `fade`/`animate-pulse` 同量级），如用户敏感可后置加 `@media (prefers-reduced-motion: reduce)` 全局收敛，**非本任务必做**。
- **性能**：骨架用纯 CSS 脉动（GPU 合成 `opacity`，与现 `animate-pulse` 同），无 `TransitionGroup` 大列表重绘；模态为单子 `<Transition>`，非批量；半面板切换若做 `mode="out-in"` 只在切换瞬时挂载一子，无持续开销。验收无「明显卡顿」即过。

## 5. 影响面与回退

- 改动文件：`src/index.css`（+.skeleton、+.scale-*）、`EnvironmentTab.vue`（重构骨架 → `.skeleton`）、`FilesTab.vue`（树/内容/子目录三处）、`FileTreeNode.vue`（`...`→骨架）、`GitTab.vue`（diff/提交文件两处 + 四模态包 Transition + 浮钮 fade）、`ScriptsTab.vue`（RUNNING 药丸态点 + 浮钮 fade）、`ProjectFormModal.vue`、`App.vue`（不含已用 fade 的 Tab 切换段）（均仅在 Gate B=② 时）、`src/lib/i18n.ts`（删 `files.loading` 与 `git.diffLoading` 两 locale 同步）。
- 回退粒度：按文件按步骤 `git checkout --`；`.index.css` 类为增量，删段即回退；i18n 删 key 可恢复（保留本 diff 提交可逆）。
- 不改 store/perload/bridge 数据契约；不改任何交互逻辑（文件加载、diff 读、提交详情、模态开关、脚本启停、折叠、拖拽分隔）。