# uTools 暗色主题融合实施计划

## Execution

1. 在 `src/App.vue` 现有 `onPluginEnter` 回调开始处调用 `updateTheme()`；不改变 `handlePluginEnter`、主题偏好或监听器结构。立即运行 `npm run lint`，确认主题生命周期修改通过类型检查。
2. 在 `src/index.css` 中仅重标定 `.dark` 下的抬升表面、文字、边框、滚动条滑块、仪表盘筛选和工具栏按钮变量；页面背景与滚动条轨道继续精确使用 `#303133`，顶部区保持 `#333333`。卡片、控件、悬停和浮层使用参考图方法的低饱和冷灰阶梯，普通按钮克制，绿色选中/主操作填充更明确。暗色主文字、图标和高对比控件使用柔和浅灰而非纯白；保留浅色、代码预览、语法高亮和状态语义。
3. 搜索 `primary-container` 的实际消费者；仅当背景/前景语义不匹配时，将对应组件前景改为 `on-primary-container`，不新增颜色值或组件调色板。
4. 运行 `npm run build`，再搜索 `src/components/**` 中新增的原始暗色值、`text-white` 暗色前景与重复主题解析；没有具体视觉证据时不新增组件级覆盖。
5. 启动 Vite 开发服务器，在暗色与浅色下检查仪表盘、项目详情、设置、环境和可触发的弹层/菜单。至少覆盖正常桌面尺寸与紧凑 uTools 类尺寸，检查插件外沿、空白区、工具栏、卡片、输入、滚动条、状态色、焦点、禁用态、文字溢出和控件遮挡。
6. 若截图显示某个局部样式确实绕过语义令牌，只在其所属组件做最小修正，并重新运行 `npm run lint`、`npm run build` 与对应页面截图检查。
7. 在真实 uTools 中完成自动主题重入检查：进入插件、隐藏、切换宿主主题、重新进入，确认主题同步；显式浅色/暗色不得被宿主切换覆盖。

## Validation Commands

```powershell
npm run lint
npm run build
rg -n "#[0-9a-fA-F]{3,8}|rgba?\(" src/components
rg -n "text-white|#fff(?:fff)?\b" src/index.css src/components
rg -n "isDarkColors|updateTheme|onPluginEnter" src/App.vue src/global.d.ts
```

浏览器验证使用 Vite `npm run dev` 和集成浏览器截图；真实 uTools 重入行为无法由普通浏览器完整模拟，需保留宿主烟雾检查结论。

## Review Gates

- `src/index.css` 仍是暗色值唯一主来源；没有新增主题依赖、Pinia 解析状态或组件级调色板。
- 所有 PRD 验收标准均有自动检查、截图或真实宿主检查对应。
- 浅色模式和代码语法配色没有变化。
- 若真实 uTools 无法在当前工具环境中启动，必须明确记录未自动完成的宿主检查，不以浏览器预览冒充。

## Rollback Points

- 完成第 1 步后可独立回退生命周期调用。
- 完成第 2 步后可按语义角色逐组恢复暗色令牌。
- 第 5 步的任何局部修正必须保持独立、可单文件撤销，不与布局或业务重构混合。
