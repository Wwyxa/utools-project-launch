# 视觉层次细化 · 技术设计（design.md）

> 父任务：[06-25-ui-polish](../06-25-ui-polish/prd.md) ｜ 本任务 PRD：[prd.md](./prd.md)

## 0. 与上游约束对齐

- 遵循父 PRD 工程约束：复用时间格式化来自 `src/lib/time.ts`；TS `enum` 运行时使用必须值导入；i18n 两 locale key 对齐（`as const` 不查死 key，需手工保对齐）；双主题只用语义 token，**减少**而非增加 `dark:` 硬编码；`npm run lint`（`tsc --noEmit`）+ `npm run build` 为验收门槛。
- 遵循前端 spec：`quality-guidelines.md` 禁止「硬编码颜色当 `src/index.css` 已有语义 token」「顺手复制类串而不抽取共用模式」「图标按钮缺无障碍名」；`component-guidelines.md` 要求语义 token、`cn` 组合、语义元素/标题层次、scoped CSS 仅用于难以用工具类表达的小过渡。
- **首页顶部概览统计带属于子任务 1 且已被用户否决回退**，本任务不触碰 `Dashboard.vue`。本任务的 "overview" 仅指 `ProjectDetails.vue` 详情页的「概览」Tab，二者不同。

## 1. 统一卡片头规范

### 1.1 现状（各 Tab 头部各自为政）

| 文件 | 头部位置 | 现状类 | 高度/字号 | 问题 |
| --- | --- | --- | --- | --- |
| `FilesTab.vue` | aside 树头（~L385） | `flex h-9 … px-3 text-xs font-bold` | h-9 / text-xs | 已接近规范，但无 `bg-surface-container-low`、标题无图标对齐主色 |
| `FilesTab.vue` | section 路径栏（~L410） | `flex h-9 justify-between … bg-surface-container-low px-3` | h-9 | 缺 `gap-2`、无标题图标 |
| `GitTab.vue` | 改动文件面板头（L2244） | `px-3 py-2 border-b … bg-surface-container-low` | 非定高 | 与其它头不一致 |
| `GitTab.vue` | 图表面板头 | 同上（px-3 py-2/pm） | 非定高 | 同上 |
| `MemoTab.vue` | 任务列表面头（~L213） | `flex h-10 … px-4`，`h3 text-sm font-bold` | h-10 / text-sm | 比规范更高大 |
| `MemoTab.vue` | 备忘面面板头（~L280） | `flex h-10 … px-4`，`text-sm font-bold` | h-10 / text-sm | 同上 |
| `ScriptsTab.vue` | 脚本列表面板 | **无头部**，直接 `grid` 渲染行 | — | PRD 点名要补标题/计数头 |

### 1.2 规范取值（固化）

按 PRD「以 CSS 类固化、便于复用、避免散落硬编码」，在 `src/index.css` 底部新增两个语义工具类（沿用现有 `@apply` 风格）：

```css
.ui-panel-header {
  @apply flex h-9 items-center justify-between gap-2 border-b border-border-subtle bg-surface-container-low px-3;
}
.ui-panel-title {
  @apply flex items-center gap-2 text-xs font-bold text-on-surface;
}
.ui-panel-meta {
  @apply text-[10px] font-bold text-on-surface-variant;
}
```

- **头容器** `.ui-panel-header`：`h-9` · `px-3` · `border-b border-border-subtle` · `bg-surface-container-low` · `justify-between gap-2`
- **标题组** `.ui-panel-title`：`text-xs font-bold text-on-surface` + 图标 `size-14` 主色（与现有 Git 分支头 `text-primary` 一致）
- **右侧计数/meta** `.ui-panel-meta`：`text-[10px] font-bold text-on-surface-variant`
- 右侧操作区：`flex items-center gap-2 shrink-0`（沿用现状）

### 1.3 各文件落地映射

- **ScriptsTab.vue**：在脚本列表面板 `grid` 之上新增 `.ui-panel-header`，标题 `TerminalSquare`/`ListTodo?`（沿用现有 import 的 `Play` 之外补 `TerminalSquare`）`size-14 text-primary` + 文案 `t.projectDetails.scripts` + 计数 `.ui-panel-meta` 显示 `scripts.length`；右侧留空（折叠控件仍为现有浮动球）。
- **GitTab.vue**：改动文件面板头、图表面板头改为 `.ui-panel-header` + `.ui-panel-title`；title 文案用现有 `t.git.files` / `t.git.history`（若缺则在 `git` 块补 key）。
- **FilesTab.vue**：aside 树头与 section 路径栏改用 `.ui-panel-header`/`.ui-panel-title`（路径栏的文件名仍为 `font-mono`，可保留其特化类叠在 `.ui-panel-header` 之上）。
- **MemoTab.vue**：两个面板头由 `h-10 px-4 text-sm` 降为 `.ui-panel-header` + `.ui-panel-title`。

> **Review Gate 项 A**：MemoTab 头当前为 `h-10/text-sm`（更突出）。统一为 `h-9/text-xs` 会降低备忘/任务面板的视觉权重。默认采纳统一规范（一致性优先），若用户希望保留备忘面板的更高权重，则 MemoTab 维持 `h-10 px-4 text-sm`、仅其它 Tab 收敛。需用户确认。

## 2. 圆角与 padding token 规则

### 2.1 圆角三档（跨组件统一）

| 档位 | 用途 | token | 现状对应 |
| --- | --- | --- | --- | --- |
| 容器 | 卡片/面板/弹层/横幅 | `rounded-lg` | 已大面积一致（GitTab 面板、ProjectDetails section、Terminal 根、FilesTab 根、ScriptsTab 面板） |
| 行内控件 | 小图标按钮/列表内行/小输入框/哈希盒 | `rounded` | FilesTab 查找图标按钮、GitTab commit hash 盒（L2999 已用 `rounded`）、Memo 删除按钮 |
| 徽标/药丸/圆点/圆形图标球 | 状态药丸/计数/折叠圆球 | `rounded-full` | 状态药丸（`px-2 py-0.5 text-[10px]`）、折叠圆球（`h-7 w-7 rounded-full`） |

落地：仅清理少量 `rounded-lg` 误用于小控件处；主体已遵循。不动 Element Plus 自身样式。

### 2.2 GitTab padding 收敛（现状 5 变体 → 3 桶 + 复用头类）

| 现状 padding | 出现位置 | 收敛到 | 说明 |
| --- | --- | --- | --- |
| `px-3 py-2` | L1884 分支横幅、L2244/面板头、L2399 commit section | 横幅/面板头 → `.ui-panel-header`；commit section 正文 → `p-3` | 头类化、正文统一 |
| `px-3 py-2.5` | L1872 toast、L3038 AI 头、L3074 tooltip | L1872 toast 保留 `px-3 py-2`（横幅统一）；L3038 头 → `.ui-panel-header`；tooltip 是独立浮层保留 `px-3 py-2` | toast 与横幅一致 |
| `px-2.5 py-2.5` | L2833/L2878 面板正文 | `p-3` | 正文统一 |
| `px-2 py-2` | L2871 AI 结果盒、L2999 hash 盒 | `p-3`（结果盒）/ 保留 `p-2`（小哈希盒需更紧） | 按密度二分 |
| `px-2.5 py-1.5` | L2420/2430/2438 行内按钮 | 保留 `px-2.5 py-1.5` | 行内操作按钮统一档 |

结果：面板头统一走 `.ui-panel-header`（无独立 padding 类），正文统一 `p-3`，行内按钮 `px-2.5 py-1.5`，药丸 `rounded-full px-2 py-0.5 text-[10px]`，小哈希盒保留 `p-2 rounded`。从 5 套收敛到「头类 / 正文 p-3 / 行内按钮 / 小盒 p-2」三层语义桶。

## 3. ProjectDetails 概览：4 等大卡 → 主次结构

### 3.1 现状（`ProjectDetails.vue` L344–360 + L363）

- `overviewMetrics` 渲染 4 个等大卡：脚本数 / 待办数 / 备忘字数 / 最新 commit。
- 紧随其后（L363）另有 `<section>` 以药丸形式列出每个脚本及其状态色——**与「脚本数」卡信息重复**。
- 备忘字数（word count）信息价值低。

### 3.2 推荐方案（主次结构，review gate 主项 B）

- **删除 4 等大卡 grid**；改为：
  - **主行（2 卡）**：① 最新 commit：值 = 短哈希，detail = commit message（truncate，附 relative time 复用 `time.ts` 的 `formatRelativeTime`）；② 待办：值 = `完成/总数`，detail = `t.memo.taskList`。
  - **保留** L363 的脚本药丸段（脚本概览的真实信息源），作为次级。
  - **删除** 备忘字数卡（备忘的存在与其内容在「备忘」Tab 内自显，无需在概览计数）；删除「脚本数」卡（与药丸段重复）。
- 既消除「为填满而填满」，又消除信息重复。

### 3.3 备选方案（若用户不接受删卡）

- 保留 4 卡但在视觉上做主次：脚本卡 + commit 卡放大（`xl:col-span-1` 主行）+ 备忘字数卡弱化为 `text-on-surface-variant/60` 小字次级，待办卡保留。改动更小但仍偏「同质」。

> **Review Gate 项 B**：概览重构属可见结构变更。默认采用 3.2（2 主卡 + 脚本药丸段 + 删冗余），需用户确认；若偏好最小改动，则走 3.3。

## 4. SettingsTab 区块分层

### 4.1 现状（`SettingsTab.vue`）

长列表 section，全部 `rounded-lg border border-border-subtle bg-surface … lg:col-span-2`，padding 在 `px-3.5 py-3`（L90 综合 section）与 `px-3.5 py-2.5`（其它 section）间二分；section 头 `h3 text-sm font-semibold` + 可选 `text-primary` 图标。属「一列同质盒子」，差异仅在图标与 padding 微差。

### 4.2 方案（主次区分，最小侵入、不破坏交互）

- **统一 section 正文 padding** 到 `p-3.5`（消除 `py-3`/`py-2.5` 二分）。
- **分组标题层次**：在 `AI` 相关 section（最高价值的配置区）的头加 `text-primary` 图标 + `h3` 维持 `text-sm font-semibold`；其余 section 标题降为 `text-on-surface-variant`（弱化）。形成「关键 section 强调 / 次要 section 收敛」两级层次，而非新增分组容器（避免结构大改）。
- **AI 配置就绪徽标** 已存在（`已配置/待配置`），保留并使其与统一药丸（`rounded-full px-2 py-0.5`）一致。
- 不改动任何设置项的 store 字段或交互；仅类与标题色。

## 5. FilesTab 国际化（一致性修复）

### 5.1 现状

`FilesTab.vue` **未 `import { useI18n }`**，所有可见文案为模板内英文字面量 + ` irritation` JS 内字符串（`matchStatusLabel` 的 `"No results"`、`statusMessage` 的 `"Saved {time}"`/`"Saved"`）。两 locale 的 `i18n.ts` **均无顶层 `files:` 块**（顶层块：zh app/common/sidebar/environment/dashboard/projectKinds/projectDetails/projectActions/scripts/git(141)/memo(190)/terminal(200)/settings(213) ‖ en(305)… 同构，`as const` 在 L607 统一覆盖）。

### 5.2 新增 `files` 块（两 locale key 清单）

> 可见文案为验收硬指标；aria/title 一并国际化以保证无障碍一致性。`{time}` 为运行时数值，组件内手工替换（见 5.3）。

| key | zh-CN | en-US | 用途 |
| --- | --- | --- | --- |
| `loading` | 加载中… | Loading... | 树加载(L385) + 文件加载(L780) |
| `noFiles` | 暂无文件。 | No files. | 空树 |
| `noFileSelected` | 未选择文件 | No file selected | 路径栏默认 |
| `selectToPreview` | 在左侧选择文件以预览 | Select a file to preview. | 无选中空态 |
| `previewUnavailable` | 无法预览 | Preview unavailable. | 不可预览文案兜底 |
| `unsaved` | 未保存 | Unsaved | dirty 徽标 |
| `editing` | 编辑中 | Editing | 状态文案 |
| `readOnly` | 只读 | Read only | 状态文案 |
| `noResults` | 无匹配 | No results | 查找匹配计数零 |
| `saved` | 已保存 | Saved | 保存提示兜底 |
| `savedAt` | 已保存 {time} | Saved {time} | `statusMessage`（`{time}` 插值） |
| `edit` | 编辑 | Edit | 编辑按钮 |
| `done` | 完成 | Done | 完成编辑按钮 |
| `findPlaceholder` | 查找 | Find | 查找输入占位 |
| `replacePlaceholder` | 替换 | Replace | 替换输入占位 |
| `findInFile` | 在文件中查找 | Find in file | aria/title |
| `editFile` | 编辑文件 | Edit file | aria/title |
| `saveFile` | 保存文件 | Save file | aria/title |
| `doneEditing` | 完成编辑 | Done editing | aria/title |
| `findReplaceAria` | 在当前文件查找并替换 | Find and replace in current file | aria/title |
| `toggleReplace` | 切换替换 | Toggle replace | aria/title |
| `findInCurrentFile` | 在当前文件中查找 | Find in current file | aria-label |
| `previousMatch` | 上一个匹配 | Previous match | aria/title |
| `nextMatch` | 下一个匹配 | Next match | aria/title |
| `closeFind` | 关闭查找 | Close find | aria/title |
| `replaceWith` | 替换为 | Replace with | aria-label |
| `replaceCurrentMatch` | 替换当前匹配 | Replace current match | aria/title |
| `replaceAllMatches` | 替换所有匹配 | Replace all matches | aria/title |
| `editFileContent` | 编辑文件内容 | Edit file content | 编辑区 aria-label |

插入位置：zh-CN 的 `git` 块之后、`memo` 块之前（L141 区间）；en-US 对应位置。保持两 locale 同序同 key。

### 5.3 组件改动

- `<script setup>` 引入 `import { useI18n } from "../../lib/i18n"` + `const t = useI18n();`。
- 模板所有英文字面量/`aria-label`/`title`/占位符替换为 `t.value.files.*` / `t.common.*`（`find` 图标按钮的 `aria-label` 用 `files.findInFile`）。
- `matchStatusLabel`：`"No results"` → `t.value.files.noResults`；数字 `i/n` 保持原样（locale 中立）。
- `statusMessage`：`Saved ${…}` → `t.value.files.savedAt`，组件内执行 `t.value.files.savedAt.replace("{time}", new Date(result.savedAt).toLocaleTimeString())`（`as const` 为静态串，插值在组件侧）。
- `Preview unavailable.` 兜底 → `selectedFile.message || t.value.files.previewUnavailable`。

## 6. Terminal 主题统一（一致性修复）

### 6.1 现状

`Terminal.vue` 已完整走 `t.terminal.*` i18n（无 i18n 工作）；唯一问题是大量 `dark:` slate/emerald/十六进制硬编码绕开语义 token，是全代码库唯一的「暗色特供」写法。

### 6.2 token 映射表（核心交付物）

策略：**所有列出的 `dark:` 覆盖均删除**；其「浅色 base 类」已是语义 token，语义 token 在 `.dark` 下早已被 `index.css` 覆写为正确的暗色取值，故删 dark 覆盖后双主题自洽，无需补类。

| 元素 | 现状 `dark:` 类 | base 语义类（保留） | 动作 |
| --- | --- | --- | --- |
| 根容器 | `dark:border-slate-700/80 dark:bg-[#0d1117] dark:shadow-[…]` | `bg-surface-container-lowest border-border-subtle` | 删 dark 3 项 |
| 头部栏 | `dark:border-slate-700/80 dark:bg-[#111820]` | `bg-surface-container-low border-border-subtle` | 删 dark 2 项 |
| 头标题图标 | `dark:text-slate-400` | `text-on-surface-variant` | 删 |
| 头标题文本 | `dark:text-slate-100` | `text-on-surface` | 删 |
| 分隔线 | `dark:bg-slate-700` | `bg-border-subtle` | 删 |
| Tab 选中 | `dark:bg-emerald-400/15 dark:text-emerald-100 dark:border-emerald-400/50` | `bg-primary/10 text-primary border-primary/40` | 删 dark 3 项 |
| Tab 未选中 | `dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800` | `bg-surface text-on-surface-variant border-border-subtle hover:bg-surface-container` | 删 dark 4 项 |
| 上/下/清按钮 | `dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800` 等 | `text-on-surface-variant/hover:text-on-surface/hover:bg-surface-variant`；清按钮 `hover:text-primary` | 删 dark 项 |
| 搜索图标 | `dark:text-slate-500` | `text-on-surface-variant/60` | 删 |
| 搜索框 | `dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-400` | `bg-surface border-border-subtle text-on-surface placeholder:text-on-surface-variant focus:border-primary` | 删 dark 5 项 |
| 日志体 bg | `dark:bg-[#0d1117]` | `bg-surface-container-lowest` | 删 |
| 日志文本 | `dark:text-slate-300` | `text-on-surface` | 删 |
| 日志时间戳 | `dark:text-slate-500` | `text-on-surface-variant/70` | 删 |
| 空/ready 占位（×2） | `dark:text-slate-500` | `text-on-surface-variant italic` | 删 |
| 光标 `_` | `dark:text-emerald-300` | `text-primary` | 删 |
| 输入条容器 | `dark:border-slate-700/80 dark:bg-[#111820]` | `border-border-subtle bg-surface-container-low` | 删 dark 2 项 |
| 输入框 | `dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-400` | `border-border-subtle bg-surface text-on-surface placeholder:text-on-surface-variant focus:border-primary` | 删 dark 5 项 |
| 发送按钮 | `dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:border-emerald-400/60 dark:hover:text-emerald-200` | `border-border-subtle bg-surface text-on-surface-variant hover:border-primary/40 hover:text-primary` | 删 dark 5 项 |

> emerald 系 dark 覆盖（emerald-100/300/400/200）本质是 `primary` 暗色取值（`#63dca6`）的手写副本，base 已用 `primary`/`primary-container` 语义 token，删之即一致。
> 校验：暗色下 Terminal 与 Terminal 之外的面板（GitTab/FilesTab，均走 `surface-*`/`border-subtle`）视觉一致，无 slate 残留。

## 7. 非目标 / 不破坏项

- 不改 `store`/`bridge`/preload 数据契约与 `preload.js`。
- 不引入新依赖。
- 不动既有交互：Git 写操作/分支切换/diff/commit、文件浏览/编辑/查找替换/快捷键（Ctrl+S/F/H/Esc）、终端选 tab/滚边界过滤/发送输入、Memo 拖拽、Settings 各项。
- 不碰 `Dashboard.vue` 与首页统计带（已回退）。加载态/骨架屏/进场过渡属子任务 3。
- FilesTab 的 `--code-preview-*` 主题化代码区、`.file-find-*` 查找栏均为既有 token/CSS，本任务不改其 CSS，仅改文案。

## 8. 兼容性 / 回退

- 改动集中在样式类与 i18n 文案，无 schema/接口变更；回退 = revert 相关提交。
- 新增 `.ui-panel-header/.ui-panel-title/.ui-panel-meta` 为纯 CSS 增量，不影响未使用者。
- i18n `files` 块为新增 key，删除时需同时清组件侧引用。
- Terminal dark 覆盖删除一步即可还原（git revert 单文件）。

## 9. 验收映射（对应 prd Acceptance Criteria）

| prd AC | 本设计对应 |
| --- | --- |
| 详情页各 Tab 卡片头统一规范、ScriptsTab 有标题 | §1 |
| 圆角/padding 跨组件一致、无混用 | §1.2 + §2 |
| ProjectDetails overview 不再 4 等大同质 | §3（2 主卡 + 药丸段，review gate B） |
| FilesTab 全程无英文硬编码可见文案 | §5 |
| Terminal 暗色无 slate 硬编码 | §6 |
| 现有功能回归（Git/文件/查找替换/终端/设置） | §7 + implement 回归清单 |
| `npm run lint` 通过 | §10 |

## 10. 验证

- `npm run lint`（`tsc --noEmit`，含 `as const` 两 locale 对齐全量类型检查）须通过。
- `npm run build`（Vite 生产构建）须通过。
- 手动回归：详情页 5 Tab 切换、Git 分支切换/提交/diff、FilesTab 查找/替换/保存/快捷键、Terminal 选 tab/过滤/发送、Settings 各项、浅色/深色双主题逐屏比对 Terminal 与面板一致性、en-US/zh-CN 切换 FilesTab 文案。