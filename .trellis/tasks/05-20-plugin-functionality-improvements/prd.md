# 插件整体功能性改进

## Goal

提升 uTools 项目启动器的日常可用性与可靠性：支持从项目详情直接用 VS Code 或其他编辑器打开项目，确保插件退出或异常结束前尽力停止已启动服务，优化设置页和详情页各 tab 的空间利用，并修复 Git 提交树在分支创建/分叉场景下的渲染问题。

## What I already know

* 项目是 Vite + Vue + Pinia + Tailwind 风格的 uTools 插件，主要桥接能力集中在 `public/preload.js`，前端能力通过 `src/lib/projectBridge.ts` 和 `src/types.ts` 暴露。
* 设置页已有默认终端偏好，存储 key 为 `utools-project-launch.settings.v1`，目前没有默认编辑器偏好。
* 详情页头部已有“在终端中打开”和“打开项目目录”按钮，适合新增“在编辑器中打开”的图标按钮。
* preload 已用 `activeProcesses` Map 跟踪插件启动的脚本进程，手动停止通过 `stopProcess(pid)` 实现，但尚未看到退出生命周期统一清理。
* Git 数据来自 `git log --all --graph --decorate=short --pretty=format:%h\t%p\t%an\t%ad\t%D\t%s`，前端目前根据 parents 重新计算 lanes 渲染 SVG，容易与 Git 原始 graph 的分叉/合流/从某提交创建分支的形态不一致。
* 文件 tab 已采用铺满详情区域的布局；脚本、Git、备忘 tab 还有固定高度或内容不够铺满的问题。

## Requirements

* 在项目详情页增加“在编辑器中打开”入口，默认支持 VS Code，并允许通过设置页切换 Cursor 或自定义编辑器命令。
* 在首页项目 card 中也增加“在编辑器中打开”入口，保持与详情页同一编辑器偏好和禁用逻辑。
* 设置页新增默认编辑器配置，布局跟随当前主界面风格，按钮/选项更紧凑，避免大面积低效按钮。
* 通过 bridge/preload 实现打开编辑器能力，支持常见默认项和自定义命令模板，模板至少支持 `{path}` / `{projectPath}` 占位符。
* 插件退出、窗口卸载或可监听的异常结束前，尽力停止所有仍在运行的插件启动脚本，避免残留进程。
* 服务停止应覆盖正常手动退出、插件生命周期退出、页面 unload/beforeunload 等可控场景；软件崩溃这类不可拦截场景应采用最佳努力策略，不承诺 100% 拦截。
* 优化设置页布局，保持与主界面一致的 surface/border/compact control 风格，避免按钮横向铺满占用过多空间。
* 优化详情页 `overview`、`scripts`、`git`、`memo` 等 tab 的尺寸和摆放，使其在不同窗口大小下更接近文件 tab 的铺满体验，同时不遮挡或压缩关键内容。
* 修复 Git 树渲染中分支创建、分叉、合流等场景的显示问题，保留原本 SVG 提交树体验，不退化为纯文本 graph 前缀；提交 ref 标签能清晰体现 HEAD、分支、tag。
* 设置页排版需要避免细长按钮形态，选项控件应更像紧凑分段控件或自然宽度按钮。
* 运行日志框需要适配浅色模式，不能只使用深色终端背景/文字。
* Git SVG 树渲染继续参考 lane-based 实现优化，优先当前分支 lane、稳定 lane 色彩、合流连接线和 active lanes 表达。
* 保持中英文 i18n 文案完整。

## Acceptance Criteria

* [ ] 项目详情页存在“在编辑器中打开”按钮，路径不可用时禁用，点击后能使用默认 VS Code 打开项目目录。
* [ ] 首页项目 card 存在“在编辑器中打开”按钮，路径不可用时禁用，点击行为与详情页一致。
* [ ] 默认编辑器配置内置 VS Code、Cursor、自定义命令三个选项；默认值为 VS Code。
* [ ] 设置页可选择默认编辑器并填写自定义编辑器命令，设置能持久化并在下次启动读取。
* [ ] 自定义编辑器命令为空或无效时不会崩溃，并向运行日志写入失败原因。
* [ ] 插件内启动的脚本在手动停止、页面退出/插件退出生命周期中会被逐个停止并清理状态。
* [ ] 设置页在常见窄窗口和宽窗口下按钮不再显得过宽或细长，关键选项仍易扫描和操作。
* [ ] 脚本、Git、备忘 tab 在详情页内使用可伸缩布局，滚动边界清晰，不影响日志、提交树、备忘内容展示。
* [ ] Git 提交树能以 SVG 线条/节点形式正确展示含分支创建点/分叉/合流的历史，不再因为前端 lane 计算导致明显错线或漏线。
* [ ] 运行日志框在浅色与深色主题下都有可读背景、边框、文本、筛选框和日志颜色。
* [ ] `npm run lint` 与 `npm run typecheck` 通过。

## Definition of Done

* Tests added/updated where a small unit boundary exists, otherwise verified through lint/typecheck and targeted manual behavior checks.
* Lint and typecheck pass.
* Behavior changes are captured in Trellis notes/spec if they introduce reusable project conventions.
* No unrelated refactors or formatting churn.

## Technical Approach

* Extend terminal preferences into separate editor preferences rather than overloading terminal settings.
* Add bridge methods for editor preference load/save and opening a project in the configured editor.
* Reuse existing detached process helper for external editor launches where appropriate; prefer `code` / `code.cmd` for VS Code on Windows, `cursor` / `cursor.cmd` for Cursor, with custom command fallback.
* Add a centralized best-effort `stopAllProcesses` helper in preload and attach it to available lifecycle hooks (`beforeunload`/`unload`, uTools plugin hooks if present, process exit-like events if available in preload context).
* For Git graph, keep the original SVG graph experience and fix the lane algorithm so branch/fork/merge rows stay coherent. Do not replace the visual graph with plain text graph prefixes.
* Use flex/grid `min-h-0`, `flex-1`, bounded internal scroll regions, and compact icon controls to align tab layouts with the Files tab.

## Decision (ADR-lite)

**Context**: 编辑器入口既要满足“在 VS Code 中打开”的主需求，又要给其他编辑器留出低成本扩展空间。

**Decision**: 采用轻量配置：内置 VS Code、Cursor、自定义命令；默认 VS Code，自定义命令支持 `{path}` / `{projectPath}`。

**Consequences**: 设置页保持紧凑，不做编辑器探测或大量预设；未来如需要可追加更多内置编辑器选项。

## Out of Scope

* 不实现编辑器安装探测或自动下载。
* 不实现 Git 写操作（创建分支、checkout、merge 等），本任务只改展示。
* 不保证操作系统/宿主进程硬崩溃时一定能清理所有子进程；此类场景按可监听生命周期尽力处理。

## Technical Notes

* Likely files: `public/preload.js`, `src/types.ts`, `src/lib/projectBridge.ts`, `src/store/useStore.ts`, `src/lib/i18n.ts`, `src/components/layout/SettingsTab.vue`, `src/components/project/ProjectDetails.vue`, `src/components/project/ScriptsTab.vue`, `src/components/project/GitTab.vue`, `src/components/project/MemoTab.vue`.
* Existing setting storage key may need migration/normalization so old terminal settings continue to load.