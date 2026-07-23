# uTools 暗色主题融合设计

## Boundary

实现默认只修改两个应用文件：

- `src/App.vue`：在既有 `onPluginEnter` 回调中重新执行 `updateTheme()`，修复插件隐藏期间宿主主题变化后根节点主题类过期的问题。
- `src/index.css`：重标定现有 `.dark` 语义令牌及相邻的仪表盘控件变量，使全部主要界面通过共享令牌获得中性炭灰视觉。

Vue 组件继续消费现有 `surface-*`、`on-surface*`、`border-*` 和状态语义类。只有视觉验证证明某个局部样式绕过共享令牌时，才在原组件中做最小修正；不预先重写组件模板。

## Theme Resolution

保留现有单一数据流：

```text
store.theme (light | dark | auto)
  -> App.vue updateTheme()
     -> auto: utools.isDarkColors() or prefers-color-scheme fallback
     -> document.documentElement .dark
        -> src/index.css semantic tokens
           -> dashboard, details, settings, environment and overlays
```

`onPluginEnter` 是宿主边界上的补充同步点，不新增 `resolvedTheme` 状态、主题 composable、轮询或 preload 桥接。显式 `light` / `dark` 仍由 `updateTheme()` 保持优先级，不会被宿主覆盖。

## Palette Strategy

uTools 官方文档只提供明暗检测，不发布宿主暗色调色板。因此颜色值是基于用户截图的项目设计选择，必须在真实宿主中校准，不能标记为官方色。

- 用户实测 uTools 暗色底色为 `#303133`，因此页面背景与滚动条轨道精确使用 `#303133`；顶部工具区保持 `#333333`。最低/低层表面使用 `#333333` 至 `#353535`、标准卡片约 `#383838`、高层/悬停/浮层约 `#3e3e3e` 至 `#474747`，保持清楚但不过分拉开的明度阶梯。
- 参考“快命令”插件的层级方法，将抬升表面从完全中性灰调整为轻微冷调的低饱和灰：标准卡片约 `#3c3f44`，控件约 `#383b40`，悬停/高层表面约 `#44484e`，最高浮层约 `#4d525a`；宿主底色和顶部工具区不变。
- 主文字与图标使用接近中性的柔和浅灰，次级文字使用中灰；暗色令牌及暗色专用控件不使用纯白前景，边框只比相邻表面略亮，避免发白描边。
- 工具栏、输入控件、筛选标签、滚动条和浮层从同一表面阶梯取值，不建立页面专属色板。
- 保留绿色作为品牌、主操作和运行状态语义，不复制参考插件的蓝色。默认按钮使用抬升灰，绿色只在主操作、选中、聚焦和运行态提高填充或边缘强调；缩小大面积高饱和填充的视觉权重。
- 保留错误、警告、信息等既有状态语义；危险按钮等高对比控件也使用带色相的柔和浅灰前景，确保默认、悬停、按下、选中、聚焦、禁用和运行中状态可区分。
- 不修改浅色 `@theme` 令牌，也不修改 `--code-preview-*` 与 `--syntax-*`，避免代码预览与 diff 配色回退。

## Component Impact

- `ProjectCard.vue` 和 `MemoTab.vue` 中现有 `dark:` 类仍引用语义令牌，不构成第二套硬编码调色板，默认保留。
- 若组件使用 `primary-container` 背景却搭配 `on-primary` 前景，应改用匹配的 `on-primary-container` 语义，避免暗色按钮文字对比失真。
- 阴影保持低对比、以黑色透明度表达高度；若现有偏蓝阴影在新表面上可见，再局部改为中性黑透明度。
- 弹窗、下拉菜单、日期选择器、上下文菜单和工具提示继续使用共享浮层表面、边框和阴影。
- 代码预览保持现有 GitHub 风格语法令牌，与应用壳层中性化相互独立。

## Compatibility

- 浏览器预览继续在没有 `window.utools` 时回退到 `matchMedia`，不得抛出运行时错误。
- uTools 自动模式在初次挂载、媒体查询变化、用户偏好变化和每次插件进入时同步。
- 浅色模式、布局、尺寸、交互、持久化结构、preload 和 `plugin.json` 均不变。
- 不新增依赖、主题配置项、迁移或公共 API。

## Validation

- 自动检查：`npm run lint`、`npm run build`、扫描新增的组件级原始暗色值，并确认主题解析仍只有一个所有者。
- 浏览器视觉检查：在正常桌面尺寸和紧凑 uTools 类尺寸下分别检查浅色/暗色的仪表盘、项目详情、设置/环境及全局弹层；保存关键截图并检查控制台错误、溢出和遮挡。
- 真实宿主检查：自动模式下隐藏插件、切换 uTools 明暗主题并重新进入，确认根 `.dark` 与 `utools.isDarkColors()` 一致；同时检查插件外沿、空白区、工具栏和滚动条与宿主的色温连续性。

## Rollback

改动不涉及数据迁移。生命周期修复可删除 `onPluginEnter` 中的 `updateTheme()` 调用；视觉改动可恢复 `.dark` 令牌及仪表盘变量。若个别表面校准失败，可只回退对应语义角色，不影响组件结构。
