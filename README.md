# uTools 项目管理器

一个面向本地开发的 uTools 插件，用于管理 Node.js、Python、Go、自定义命令和已编译可执行文件项目。当前版本包含项目手动添加、启动/停止命令、Git 只读状态、项目备忘和中英文界面切换。

## 功能

- 手动添加本地项目，配置路径、类型、启动命令、环境变量和备忘。
- 支持 Node.js、Python、Go、可执行文件和自定义项目类型。
- 支持前端、后端、主程序、辅助任务等命令分组。
- 在 uTools preload 中使用 Node.js 能力启动/停止本地命令，并把输出回传到运行日志。
- Git 面板以只读方式展示分支、ahead/behind、文件变更和最近提交。
- 默认中文界面，支持切换 English。

## 开发

```bash
npm install
npm run dev
```

本地开发服务默认运行在 `http://localhost:3421`。

## 构建

```bash
npm run lint
npm run build
```

构建产物输出到 `dist/`。根据 uTools 插件目录要求，加载或打包插件时应选择构建后的 `dist/plugin.json`，不要把整个项目根目录作为插件包。

构建后的关键文件结构：

```text
dist/
├── index.html
├── plugin.json
├── preload.js
├── logo.svg
└── assets/
```

## uTools 加载

1. 执行 `npm run build`。
2. 打开 uTools 开发者工具。
3. 选择工程配置文件 `dist/plugin.json`。
4. 在 uTools 中通过 “项目管理”、“项目启动器” 或 `project manager` 指令打开插件。

## 说明

- `public/plugin.json`、`public/preload.js` 和 `public/logo.svg` 会被 Vite 复制到 `dist/`。
- `preload.js` 按 uTools 要求保持为可读 CommonJS 文件，不参与前端打包和压缩。
- 当前 Git 功能为只读展示，不执行提交、推送、拉取等写操作。
