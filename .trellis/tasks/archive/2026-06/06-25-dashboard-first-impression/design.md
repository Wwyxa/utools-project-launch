# 技术设计：首页观感

> 任务：[06-25-dashboard-first-impression](./prd.md) · 父任务：[06-25-ui-polish](../06-25-ui-polish/prd.md)

## 范围与边界

改动文件：

- [src/components/dashboard/Dashboard.vue](src/components/dashboard/Dashboard.vue) — 概览带、空状态
- [src/components/dashboard/ProjectCard.vue](src/components/dashboard/ProjectCard.vue) — 卡片层次
- [src/lib/i18n.ts](src/lib/i18n.ts) — 新增 dashboard 文案 key（两 locale 对齐）
- [src/index.css](src/index.css) — 概览带/空状态所需少量类（如复用已有则不新增）
- `src/lib/time.ts`（新建）— 提取相对/绝对时间格式化，供 Dashboard 与 ProjectCard 共用

不改：store 持久化结构、bridge/preload、其他 Tab、Terminal、设置页。

## 方案 A：概览统计带

### 位置

Dashboard 模板中，工具栏 `<div class="dashboard-toolbar ...">` 之后、`projectStorageMessage` 与卡片网格之前，插入：

```html
<section v-if="hasProjects" class="overview-strip ..."> ... </section>
```

`hasProjects = computed(() => store.visibleProjects.length > 0)`，项目数为 0 时不渲染（空状态接管）。

### 指标派生（Dashboard 内 computed，不新增 store getter）

基于现有 store state/getters，全部即时可得、不触发 Git 命令：

```ts
const total = computed(() => store.visibleProjects.length);
const running = computed(
  () => store.visibleProjects.filter((p) => p.status === ProjectStatus.RUNNING).length,
);
const issues = computed(
  () =>
    store.visibleProjects.filter(
      (p) => p.status === ProjectStatus.ERROR || p.pathExists === false,
    ).length,
);
const recentActivityAt = computed(() =>
  store.visibleProjects
    .map((p) => p.gitLatestCommitAt || p.updatedAt || p.createdAt || p.lastUpdated || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "",
);
```

`recentActivityAt` 取所有项目时间字符串的字典序最大值（ISO 字符串可字典序排序；`lastUpdated` 是 `toLocaleString()` 非 ISO，作为兜底）。相对时间用提取后的 `formatRelativeTime`。

> 备选：在 store 加纯派生 getter `dashboardMetrics`。权衡后选择组件内 computed —— 改动面最小，且指标仅首页使用。若后续别处复用再上提。

### 指标卡布局

```html
<section class="overview-strip grid grid-cols-2 gap-2 px-6 pt-3 sm:grid-cols-4">
  <article class="overview-card" :data-tone="metric.tone" v-for=...>
    <component :is="metric.icon" :size="16" />
    <span class="overview-card-value">{{ metric.value }}</span>
    <span class="overview-card-label">{{ metric.label }}</span>
  </article>
</section>
```

四个指标：`总数(FolderOpen, neutral)`、`运行中(Activity/Play, running)`、`需关注(AlertTriangle, issue)`、`最近活动(Clock, neutral)`。

- 运行中数值/图标着 `text-status-running`；需关注着 `text-status-error`（>0）否则中性；为 0 时仍显示（数值 0），让用户确认"无异常"也是信息。
- 响应式：`grid-cols-2`（窄）→ `sm:grid-cols-4`（宽），避免与工具栏挤。
- 复用现有 token：`bg-surface`/`border-border-subtle`/`text-on-surface-variant`；色调用 `text-status-*`，不新增色值。

### CSS（index.css，最小新增）

```css
.overview-strip { /* 仅布局由 Tailwind 负责，此类可省；保留作语义钩子 */ }
.overview-card {
  display: flex; align-items: center; gap: 0.5rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: 0.5rem; background: var(--color-surface);
  padding: 0.5rem 0.75rem;
}
.overview-card-value { font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem; }
.overview-card-label { font-size: 0.7rem; color: var(--color-on-surface-variant); }
```

实际优先用 Tailwind 工具类实现，CSS 类仅在不便表达时使用（与现有 `.dashboard-filter-chip` 风格一致）。

## 方案 B：空状态重做

替换 [Dashboard.vue:287-298](src/components/dashboard/Dashboard.vue#L287-L298) 现有空状态块：

```html
<div v-if="store.visibleProjects.length === 0" class="empty-state ...">
  <PackageOpen :size="40" class="empty-state-icon" />
  <h2 class="empty-state-title">{{ t.dashboard.emptyTitle }}</h2>
  <p class="empty-state-subtitle">{{ t.dashboard.emptySubtitle }}</p>
  <div class="flex gap-2">
    <button @click="store.openCreateProjectForm" class="toolbar-primary-button ...">
      <Plus :size="16" /> {{ t.dashboard.createHint }}
    </button>
    <button @click="store.importProjectConfig" class="...次按钮...">
      <Download :size="16" /> {{ t.dashboard.emptyImport }}
    </button>
  </div>
</div>
```

- 图标用 `PackageOpen`（lucide 已有，无需新依赖），主色弱化（`text-primary/60`）。
- 居中、`py-12`，比原 `p-8` 更有空间感。
- 主按钮复用 `toolbar-primary-button`；次按钮用现有 outline 风格（参考设置页导入按钮）。

## 方案 C：项目卡片层次优化

[ProjectCard.vue](src/components/dashboard/ProjectCard.vue) 调整清单（建议值，review gate 确认）：

| 元素 | 现状 | 建议 | 说明 |
| --- | --- | --- | --- |
| 卡片内边距 | `p-2.5` | `p-3` | 增加呼吸 |
| 描述 | `text-[11px] text-on-surface-variant/85` | `text-xs text-on-surface-variant/80` | 上调可读性 |
| 路径 | `text-[10px] .../75` | `text-[11px] text-on-surface-variant/60` | 略上调但更弱化权重 |
| 时间戳 | `text-[11px]` | 保持 | — |
| 脚本按钮 | `text-[10px]` | 保持 | 紧凑控件，PRD 允许除外 |
| 脚本区→底部区间距 | `mt-3 mb-2` | `mt-3 mb-2.5` | 微增呼吸 |
| 名称 | `text-sm font-bold` | 保持 | 视觉焦点 |
| 运行徽章 | 现状 | 保持 | — |

核心思路：**正文可读信息脱离 10px 区间，路径靠透明度而非更小字号弱化**，名称/状态成为焦点。不增字段、不动网格尺寸、不动交互。

## i18n 新增 key（两 locale 对齐）

在 `src/lib/i18n.ts` 的 `dashboard` 块（zh-CN 与 en-US 各一份）新增：

| key | zh-CN | en-US |
| --- | --- | --- |
| `overviewTotal` | 项目 | Projects |
| `overviewRunning` | 运行中 | Running |
| `overviewIssues` | 需关注 | Attention |
| `overviewRecent` | 最近活动 | Recent |
| `emptyTitle` | 还没有项目 | No projects yet |
| `emptySubtitle` | 添加你的第一个开发项目，集中管理启动命令与运行状态 | Add your first project to manage launch commands and runtime status in one place |
| `emptyImport` | 从配置导入 | Import config |

> `as const` 会强制两 locale key 对齐；缺 key 即 tsc 报错，作为校验兜底。

## 时间工具提取（`src/lib/time.ts`）

将 [ProjectCard.vue:221-282](src/components/dashboard/ProjectCard.vue#L221-L282) 的 `formatAbsoluteTime` / `formatRelativeTime` 提取到 `src/lib/time.ts` 并导出，Dashboard 概览带与 ProjectCard 共用，消除重复。导出签名：

```ts
export function formatRelativeTime(value?: string): string;
export function formatAbsoluteTime(value?: string): string;
```

ProjectCard 改为 import 复用；行为保持不变（含"刚刚/N 分钟前"等中文文案——文案暂留在工具内，后续如需国际化再处理，本任务不扩大范围）。

## 数据流

```
store.visibleProjects (现有)
   └─ Dashboard computed: total / running / issues / recentActivityAt
        └─ 概览带渲染（纯派生，无副作用，不调用 bridge）
store.importProjectConfig / openCreateProjectForm (现有)
   └─ 空状态按钮直接调用
```

## 主题与无障碍

- 全部用语义 token，双主题自动适配；不新增 `dark:` 硬编码。
- 概览带 `<section aria-label="...">`；指标卡 `<article>` 语义；数值变化无需 aria-live（避免噪音）。
- 空状态图标 `aria-hidden`，标题用真实 `<h2>`。

## Tradeoff 与备选

- **概览带是否含"有 Git 改动"指标**：否决。首页 Git 快照懒加载，指标不可靠；如强刷会拖慢首屏。留给详情页。
- **指标卡数量**：4 个。备选 3 个（合并异常进运行中）——否决，异常与运行中语义不同，分开更有信息量。
- **时间工具提取**：会触动 ProjectCard。权衡后值得——消除重复且为后续国际化铺路。若 review 认为风险高，可退化为 Dashboard 内复制一份。

## 兼容性与回滚

- 全部为 UI 层新增/调整，无数据迁移。
- 回滚：还原 Dashboard.vue / ProjectCard.vue / i18n.ts / index.css / 删除 time.ts 即可；git revert 单次提交。
- Review gate：本 design 的卡片字号建议值与概览带指标集，在 implement 前由用户确认。
