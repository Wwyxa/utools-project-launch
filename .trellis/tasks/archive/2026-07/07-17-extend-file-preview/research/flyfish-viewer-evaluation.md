# Flyfish Viewer 评估

## 结论

不建议接入 `preset-office`、`preset-all` 或任一 `*-full` 包。也不建议为了 PDF-only 接入 `@file-viewer/vue3 + @file-viewer/renderer-pdf`：虽然渲染器会按格式异步执行，但依赖闭包和实际 PDF 路径下载量仍明显超出当前项目的轻量定位。

若继续扩展文件预览，优先使用浏览器原生能力实现音视频和更多原生图片格式；PDF 是否值得单独采用更窄的 PDF.js 方案，应作为独立范围评估，不复用 Flyfish Viewer 的 Vue wrapper/core/toolbar/export 体系。

## 已验证事实

- 官方版本：`2.1.30`（2026-07-17 冷安装可用）。
- 许可证：`Apache-2.0`。
- 标准 Vue 3 包：`@file-viewer/vue3`，直接依赖 `@file-viewer/core`、`@lucide/vue` 和 Vue。
- Office preset：`@file-viewer/preset-office`，包含 PDF、Word、Spreadsheet、Presentation、OFD 五个 renderer。
- Full/All 还需要复制 Worker、WASM、字体和 vendor 资产；官方分发文档明确提到 Typst compiler WASM 约 27 MB。
- 组件接受 `File` 输入，适合由 preload 读取二进制后包装成带扩展名的本地 `File`。
- 官方声明 206 个扩展名映射、24 条预览链路，但部分复杂工程格式只是结构预览，不等于高保真渲染。

## 可复现体积实验

环境：Windows、npm、Vite 6.2.3、Vue 3、安装时使用 `--ignore-scripts --no-audit --no-fund`，实验目录位于 `C:\tmp`，未修改业务项目。

### Vue3 + Office preset

命令：

```powershell
npm install --prefix C:\tmp\flyfish-size-probe --ignore-scripts --no-audit --no-fund @file-viewer/vue3@2.1.30 @file-viewer/preset-office@2.1.30
```

- 新增 106 个包。
- `node_modules` 文件总占用约 182.05 MiB。
- 主要目录：`@napi-rs/canvas-win32-x64-msvc` 36.01 MiB、`pdfjs-dist` 35.89 MiB、`@lucide/vue` 19.49 MiB、`pdf-lib` 18.56 MiB、`billboard.js` 11.35 MiB、`rtf.js` 10.92 MiB、`styled-exceljs` 8.24 MiB。

### Vue3 + PDF renderer

命令：

```powershell
npm install --prefix C:\tmp\flyfish-pdf-probe --ignore-scripts --no-audit --no-fund @file-viewer/vue3@2.1.30 @file-viewer/renderer-pdf@2.1.30
npm exec --prefix C:\tmp\flyfish-pdf-probe vite -- build C:\tmp\flyfish-pdf-probe
```

- 新增 47 个包；`node_modules` 文件总占用约 134.19 MiB。
- 最小生产构建共约 2.61 MB minified / 837 KB gzip JavaScript。
- 关键异步块：PDF renderer 800.89 KB / 242.39 KB gzip，PDF worker 1,091.49 KB / 322.50 KB gzip，字体修复 437.50 KB / 181.10 KB gzip。
- 同版本 Vue 空白基线为 62.20 KB / 24.67 KB gzip，因此 Flyfish PDF-only 净增量约 2.55 MB minified / 813 KB gzip。
- Vite 对 PDF renderer 与 worker 均发出大于 500 KB 的 chunk 警告。

## 本项目接入边界

- 当前 `readProjectFile` 仅返回文本、图片 data URL 或不可预览状态；通用二进制预览需增加严格大小上限的数据契约。
- 当前文本上限 512 KiB，图片上限 2 MiB；二进制预览也应先检查文件大小再读取。
- 即使使用动态 import 保持 Files Tab 首屏不增长，用户首次打开 PDF 仍需下载约 813 KB gzip 的净新增 JS，并承担 Worker/字体等资产部署与维护成本。
- 当前项目已使用 `lucide-vue-next`；该库额外依赖 `@lucide/vue`，会形成重复图标体系。

## 官方证据与命令

- https://doc.file-viewer.app/zh/guide/
- https://doc.file-viewer.app/zh/guide/quickstart-vue3
- https://doc.file-viewer.app/zh/guide/on-demand-renderers
- https://doc.file-viewer.app/zh/guide/formats
- https://doc.file-viewer.app/zh/guide/format-fidelity
- https://doc.file-viewer.app/zh/guide/distribution

```powershell
smart-search fetch "https://doc.file-viewer.app/zh/guide/" --format markdown
smart-search map "https://doc.file-viewer.app/zh/" --instructions "Find installation, supported formats, framework integration, package size, license, changelog, and API reference pages" --max-depth 2 --max-breadth 30 --limit 80 --format json
smart-search fetch "https://doc.file-viewer.app/zh/guide/quickstart-vue3" --format markdown
smart-search fetch "https://doc.file-viewer.app/zh/guide/on-demand-renderers" --format markdown
smart-search fetch "https://doc.file-viewer.app/zh/guide/formats" --format markdown
smart-search fetch "https://doc.file-viewer.app/zh/guide/format-fidelity" --format markdown
smart-search fetch "https://doc.file-viewer.app/zh/guide/distribution" --format markdown
```
