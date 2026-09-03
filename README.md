# uTools 项目管理器插件 (uTools Project Launch)

一个给开发者用的 uTools 项目快捷启动与管理插件。把常用项目、启动脚本、运行日志、定时任务、Git 状态、文件预览、备忘待办和本机开发环境检测收进同一个轻量入口，适合管理前端、后端、脚本工具、桌面程序或任何需要频繁启动的本地工程。

## 为什么做它

本地开发项目一多，常见动作会变得很分散：找目录、开终端、跑脚本、看日志、查 Git 改动、记启动说明、定时跑维护任务、检查 Node/Python/Go/Git 是否可用。此插件把这些高频动作集中到一起，用一个入口完成项目定位、启动、观察和轻量维护。

## 主要功能

### 首页项目总览

- 项目卡片支持**标准** / **精简**两种样式，直接展示运行状态、脚本按钮、最近运行时间与分组。
- 支持搜索、按分组筛选、拖拽排序、快捷访问链接(HTTP 地址或本地文件/目录)。
- 顶栏提供**未完成待办概览**、**跨项目定时任务概览**，以及全局运行状态反馈条。
- 支持一键复制项目生成可编辑副本，以及项目配置导入导出。

### 脚本运行与日志

- 每个项目可配置多个启动命令，支持启动、停止、状态展示与拖拽排序，可为每个命令单独设置工作目录。
- 内置**运行日志终端**：实时输出、日志筛选、自动滚动、一键复制，并可向运行中的脚本发送输入。
- **脚本自动发现**：从 `package.json` scripts 或 `Makefile` 目标一键导入为启动命令(危险目标需显式确认)。

### 定时任务

- 为项目创建定时任务，串行执行一个或多个脚本，同一项目内互不并发。
- **固定时间**或**随机时间窗口**两种计划，支持错过策略(宽限内立即执行 / 过期后立即执行 / 标记错过)。
- **自动输入序列**：按固定延迟发送，或匹配到脚本输出后发送；支持匹配关键词后自动停止脚本。
- 支持对任务**立即执行**，或对尚未到点的计划项**提前执行**；脚本可设为持续运行，在自动输入完成后继续后续任务而不等待该脚本退出。
- 单脚本最大运行时长兜底、失败即停；支持系统通知开关与最近 20 条执行历史。未启用项目启动服务时，定时任务仍由插件前台调度。

### 项目启动服务(可选)

- **项目启动服务(Project Launch Service)**默认关闭；未下载、未安装或保持关闭时，不会自动下载或启动，也不会改变现有脚本与定时任务的使用方式。
- 适合需要在关闭插件或完整退出 uTools 后仍让开发服务、构建脚本和定时任务继续运行的场景；仅偶尔手动执行短命令时无需启用。
- 启用后，服务统一拥有所有新的脚本启动和定时任务调度，可在插件面板或整个 uTools 退出后继续运行并在下次打开时恢复连接；同时提供持久化运行日志和历史查看，避免前台/后台双重调度。
- 服务不是开机自启的系统服务：设备重启后不会继续运行；再次打开插件且服务模式已启用时，会使用已验证的本地可执行文件恢复服务。

### 文件浏览与轻量编辑

- 内置文件树：展开/折叠、按名称过滤、新建/重命名/删除文件与目录、复制相对/绝对路径。
- 文本预览：代码高亮、Markdown 渲染(含本地图片)、图片查看。
- 轻量编辑：行号开关、查找/替换、未保存内容保护。

### 可选：外部文件图标包

- 设置页提供一个全局的 `vscode-icons` 衍生图标包。它按需从独立 GitHub Release 下载，默认不安装、不联网，也不进入主插件构建产物。
- 点击“安装图标包”后，插件会限制下载地址、校验 SHA-256、验证清单和资源，再将压缩包原子安装到 `~/.utools-project-launch/icon-packs/`。安装完成后仍需手动选择“启用外部图标”。
- 图标包在项目文件树、Git 工作区文件列表和 Git 提交文件列表中使用同一套文件名、扩展名、目录和展开目录匹配；切换回内置图标或移除包都会保留 Lucide 回退，不能用的包不会清空任何视图。
- 图标包只包含数据和内联 SVG/PNG，不执行 VS Code 扩展代码，也不会把上游扩展代码带入运行时。更新、移除和切换都必须由设置页按钮显式触发。
- 该衍生包保留完整的上游通知：`vscode-icons` 源代码使用 MIT，图标资产使用 CC BY-SA 4.0，品牌图标可能适用其自身版权或商标许可。完整通知随源目录和 Release 资产 `LICENSES-vscode-icons.txt` 一起发布，不能只依赖 README 摘要。
- 仓库中的 `icon-packs/vscode-icons-derived/manifest.json` 和 `icon-packs/vscode-icons-derived/icons/` 是构建脚本根据上游资源自动生成的源包，不需要手动维护。清单的 `source.version` 自动读取 `references/vscode-icons/package.json`（当前为 `12.19.0`），`manifest.version` 是独立的图标包版本；本地构建可通过 `ICON_PACK_VERSION` 指定版本，Release workflow 会从 `icon-pack-v<图标包版本>` 标签自动注入该值。更新上游参考目录和图标包版本后再次运行 `npm run icon-pack:build` 和 `npm run icon-pack:validate` 即可同步，最终压缩包不会进入主插件。

### Git 工作区

- 仓库列表统一展示**主仓库**、**linked worktree** 与已检出 **submodule**，支持 Git 环境继承(Git 钩子可正常执行)。
- 工作区变更：暂存 / 取消暂存 / 丢弃、stash、提交(含 amend、AI 生成提交信息、撤销上次提交)。
- **Diff 查看**：统一 / 分屏两种模式、字符级差异高亮、忽略空白切换、hunk 导航与全文展开。
- **提交历史**：提交图渲染与虚拟化滚动、关键词 / 作者 / 日期筛选、提交右键菜单、提交 tooltip 与 GitHub 一键跳转；可在提交上创建、查看、删除和推送标签，也可检出指定提交进入分离 HEAD。
- 常用仓库操作：分支与标签管理、远端与远端分支管理、带实时进度的 fetch / pull / push、**发布当前分支**、**初始化仓库**、单提交 cherry-pick / revert(冲突自动中止并恢复)。当前 HEAD 有标签时，推送可选择一并推送标签或仅推送提交。

### AI 辅助分析

- 对 Git 变更或提交范围生成**总结**、**分析**、**评估**(内置模式，支持自定义提示词)。
- 根据 diff 一键生成 **commit message**。
- **多轮修订**：可在已有分析结果上继续追问，线性版本回溯，不丢失历史版本。
- 支持 uTools 内置模型、OpenAI 兼容接口、Anthropic 兼容接口。

### AI Agent 工具

uTools AI Agent 可直接查询和维护项目配置，无需打开插件界面：

| 工具                             | 用途                                             |
| -------------------------------- | ------------------------------------------------ |
| `project_manager_list_projects`  | 获取所有项目的简要信息                           |
| `project_manager_get_project`    | 获取一个项目的详细信息与脚本；环境变量仅返回键名 |
| `project_manager_upsert_project` | 创建或局部更新项目配置与环境变量                 |
| `project_manager_upsert_script`  | 向项目创建或局部更新启动脚本                     |

这些工具复用插件既有的项目存储与规范化逻辑。`project_manager_list_projects` 同时返回当前实际使用的 `groups` 和受支持的 `projectTypes`；创建或编辑项目时应从 `projectTypes` 选择类型。`project_manager_upsert_project` 省略 `projectId` 时创建项目，提供 `projectId` 时更新已有项目；`env` 使用 `{ "key": "NAME", "value": "value" }` 项数组，按 `key` 新增或更新环境变量，`removeEnvKeys` 显式删除环境变量，详情查询不会返回变量值。`project_manager_upsert_script` 省略 `scriptId` 时创建脚本，提供 `scriptId` 时更新现有脚本。分组来自已保存项目的非空分组值，允许复用已有分组、创建新分组，或使用空字符串移出分组。

### 备忘与待办

- 每个项目独立的 Markdown 备忘，支持渲染 / 编辑切换与自动保存。
- 待办清单：勾选完成、双击编辑、拖拽排序，首页展示未完成概览。

### 开发环境检测

- 内置检测 Node.js、npm、pnpm、Yarn、Python、pip、Go、Git、Docker 的可用性、版本与路径。
- 支持自定义检测项，以及覆盖内置项的检测命令与版本参数。

### 外部应用与终端

- 预置 VS Code、Cursor，可新增自定义应用(命令模板支持 `{path}` / `{projectPath}` 占位符)。
- 左键使用默认应用打开项目，右键临时选择其他已启用应用；Git 仓库菜单中也可直接选择。
- 默认终端偏好：Windows Terminal / PowerShell / CMD / Terminal / iTerm2 / Warp / Linux Terminal，或自定义命令。

### 偏好与迁移

- 中英文界面、浅色 / 深色 / 跟随系统主题。
- 项目可见性(公共 / 本机，本机项目通过设备 ID 隔离)、详情页标签拖拽排序。
- 项目配置导入导出，旧版本偏好自动迁移。

## 界面预览

![image](docs/screenshots/pasted-image-1786085180740.png)

![image](docs/screenshots/pasted-image-1786085338508.png)

![image](docs/screenshots/pasted-image-1786085426317.png)

![image](docs/screenshots/pasted-image-1786085461768.png)

![image](docs/screenshots/pasted-image-1786086252254.png)

![image](docs/screenshots/pasted-image-1786085578185.png)

![image](docs/screenshots/pasted-image-1786085622918.png)

## 技术栈

- Vue 3 + TypeScript
- Vite 6 + Vitest
- Pinia
- Tailwind CSS 4
- lucide-vue-next
- markdown-it + highlight.js
- overlayscrollbars
- uTools preload + Node.js 本地能力
- 可选 Go 1.23 项目启动服务(终端用户不需要安装 Go)

## 快速开始

```bash
npm install
npm run dev
```

开发服务默认运行在：

```text
http://localhost:3421
```

## 构建

```bash
npm test
npm run lint
npm run build
```

构建产物输出到 `dist/`。uTools 加载插件时请选择构建后的 `dist/plugin.json`，不要直接选择项目根目录。

构建后的关键文件通常包括：

```text
dist/
├── index.html
├── plugin.json
├── preload.js
├── logo.png
└── assets/
```

## 在 uTools 中加载

1. 执行 `npm run build`。
2. 打开 uTools 开发者工具。
3. 选择工程配置文件 `dist/plugin.json`。
4. 通过 `PM`、`project manager` 打开项目管理器；直接输入项目名称关键字可一步进入对应项目的启动区。

## 可选：项目启动服务

项目启动服务是独立的本地可执行文件，默认禁用。它用于让服务接管新的脚本进程和定时任务；不启用时，插件继续使用原有 preload 进程与前台调度，现有功能不受影响。

### 外部服务的作用

- 保证本地开发服务、耗时构建或自动化脚本在关闭插件，甚至完整退出 uTools 后继续运行。
- 定时任务由独立运行时持续调度，并在下次打开插件时恢复连接与运行状态。
- 保存运行输出，在项目运行日志处查看已完成脚本的历史日志。

如果只是偶尔启动短命令，则无需启用。服务只在本机运行，不会安装为系统服务，也不需要管理员权限或特殊环境。

### 安装、更新与手动恢复

服务文件已发布在 [GitHub Releases](https://github.com/Wwyxa/utools-project-launch/releases)，正常使用不需要打开终端或手动下载文件：

1. 在设置页的“项目启动服务”区域查看检测到的系统、CPU 架构、预期资源名和本地安装路径。
2. 首次使用时点击“下载并安装”。插件只下载当前平台对应的 Release 资源，校验 `checksums.txt` 中的 SHA-256 值，并原子安装到服务目录；下载成功本身不会自动启用或启动服务。
3. 停止当前运行或正在停止的脚本后，打开“启用服务模式”。从此所有**新的**脚本启动和定时任务都交由服务统一管理。
4. 已安装服务需要升级时，先点击“检查更新”。该操作只读取最新 Release 与校验和，不会自动下载、替换或重启服务；发现更新后，先停止服务拥有的活动脚本和任务，再按提示确认“下载并安装”。
5. 网络、代理、GitHub 访问或目录权限导致自动下载失败时，可从发布页手动下载下表中与当前平台一致的资源，放入对应可执行文件路径后点击“验证本地安装”。“验证本地安装”不会联网下载或替换文件。

设置页还提供“打开发布页”和“打开服务目录”，方便确认可用资源与本地安装位置。

用户数据根目录固定为 `~/.utools-project-launch/`，其中 `~` 是当前用户主目录。现有的 `device-id.v1` 保持在根目录（如果配置了项目仅在本机才会有）；服务管理的可执行文件、发现信息、状态、令牌、日志和下载临时文件都只放在 `service/` 下：

```text
~/.utools-project-launch/
├── device-id.v1
└── service/
  ├── project-launch-service.exe  # Windows
  └── project-launch-service      # macOS / Linux
```

当前机器只会安装其中一个可执行文件：Windows 的准确路径是 `~/.utools-project-launch/service/project-launch-service.exe`，macOS 和 Linux 的准确路径是 `~/.utools-project-launch/service/project-launch-service`。设置页的“打开目录”会直接打开这个服务目录。

### 日志保留与查看

服务模式默认会把每次脚本运行的结构化日志写入 `service/logs/<runId>.log`。默认最多保留每个项目 200 条已完成运行记录、单次运行最新 5 MiB 输出和全部日志合计 100 MiB；达到数量或容量上限时先删除最旧的已完成运行日志，活动运行日志优先保留。服务启动时也会执行同一清理规则，避免旧版本遗留的小日志持续累积。

可在设置页关闭日志持久化，或调整每个项目的已完成运行数量、单次日志容量和总容量，也可以主动清除已保存日志。

启用且连接到项目启动服务后，可在项目运行日志工具栏点击“历史日志”，按运行时间查看当前项目仍被保留的日志。已被容量策略淘汰的日志会明确显示为不可用；发生截断时只展示仍保留的最新输出。日志不写入完整环境变量、服务令牌或凭据。

### 所有权、停用与故障恢复

- 服务关闭、未安装或明确禁用时：新的脚本由现有 preload 执行，定时任务由插件前台调度，保持原有行为。
- 服务启用且健康时：所有新的脚本启动和定时任务统一由服务拥有，没有按项目、脚本或任务拆分的委托开关，以避免双重调度。
- 服务已启用但缺失、不兼容或不可访问时：新的脚本启动和定时任务会被阻止并显示可操作提示，不会回退到 preload 执行。请通过“验证本地安装”、重新下载或手动放置正确资源修复后再继续。
- 需要停用或移除服务时，先停止服务拥有的活动进程和任务；完成明确的停止/切换后，后续启动才会恢复为 preload 所有。
- 服务可跨插件关闭和完整 uTools 退出保持运行，但不跨设备重启；它不要求管理员权限，也不安装为操作系统服务。

## 常用命令

| 命令                                  | 说明                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `npm test`                            | 运行全部插件 Vitest 测试                                   |
| `npm run dev`                         | 启动 Vite 开发服务，默认端口 `3421`                        |
| `npm run build`                       | 构建 uTools 插件产物到 `dist/`                             |
| `npm run preview`                     | 本地预览构建结果                                           |
| `npm run lint` / `npm run type-check` | TypeScript 类型检查 (`tsc --noEmit`)                       |
| `npm run clean`                       | 删除 `dist/` 构建目录                                      |
| `npm run test:git-diff`               | 运行 Git diff 相关单元测试                                 |
| `npm run validate:ai-reasoning`       | 校验 AI reasoning 解析兼容性                               |
| `npm run validate:git-commits`        | 校验 Git 提交记录解析                                      |
| `npm run validate:git-diff`           | 校验 Git diff 解析                                         |
| `npm run validate:git-workspace`      | 校验 Git 工作区桥接(含单元测试)                            |
| `npm run validate:project-files`      | 校验项目文件桥接                                           |
| `npm run validate:project-storage`    | 校验项目存储兼容性和 AI Agent 工具持久化                   |
| `npm run validate:process-results`    | 校验进程结果批次处理                                       |
| `npm run icon-pack:build`             | 从 vscode-icons 上游资源生成项目图标包和 Release 资产      |
| `npm run icon-pack:validate`          | 校验图标包清单、资源、许可证通知和 SHA-256                 |
| `npm run benchmark:git-interactions`  | Git 交互性能基准测试                                       |
| `npm run go:fmt`                      | 格式化可选项目启动服务源码                                 |
| `npm run go:vet`                      | 校验可选项目启动服务                                       |
| `npm run go:test`                     | 运行可选项目启动服务测试                                   |
| `npm run go:build`                    | 构建到 `service/bin/` 并注入当前 Git 版本（贡献者需要 Go） |

## 项目结构

```text
src/
├── App.vue                  # 应用入口与 uTools 生命周期处理
├── components/
│   ├── dashboard/            # 项目总览与项目卡片
│   ├── environment/          # 开发环境检测
│   ├── layout/               # 设置页
│   ├── project/              # 项目详情：脚本、定时任务、文件、Git、备忘
│   └── terminal/             # 运行日志终端
├── composables/              # 可复用组合式函数(如可拖拽分栏)
├── lib/                      # i18n、Markdown、Git diff/提交图、桥接与工具函数
├── store/                    # Pinia 状态与业务动作
└── types.ts                  # 共享类型定义

public/
├── plugin.json               # uTools 插件配置
├── preload.js                # uTools CommonJS preload 入口加载器
├── preload/                  # 按职责拆分的 preload 运行时模块
└── logo.png

service/                      # 可选的 Project Launch Service Go 运行时
├── bin/                       # 本地构建输出（已忽略）
├── cmd/project-launch-service/# 服务可执行文件入口
└── internal/                  # API、进程、调度、状态与平台实现

.github/workflows/
├── service-ci.yml             # 插件与服务格式、静态检查、测试及构建
└── service-release.yml        # service-v* 标签发布与校验和资产上传

tests/                        # Vitest 单元测试
scripts/                      # 校验与基准脚本
```

图标包的项目源资源位于 `icon-packs/vscode-icons-derived/`，独立发布输出位于被忽略的 `icon-packs/vscode-icons-derived/icon-pack-release/`；它们都不会被 Vite 复制到 `dist/`。发布使用 `.github/workflows/icon-pack-release.yml`，标签格式为 `icon-pack-v<图标包版本>`，与项目插件和 Project Launch Service 的发布流程分开。

## 数据与权限说明

- 项目配置、偏好设置、AI 配置、备忘和待办主要保存在本地 uTools / 浏览器存储中。未启用项目启动服务时，定时任务依赖插件运行期间的前台调度，错过计划不会自动补跑；启用服务后，调度和有限的运行历史由本机服务目录持久化，并按原有错过策略执行。
- 项目启动服务只在本机运行，服务文件位于 `~/.utools-project-launch/service/`；它使用本地回环连接管理受托脚本和调度，不会把项目数据迁移到云端或创建第二个用户数据根目录。服务的自动化配置在 `state.json` 中使用本机服务令牌派生的密钥加密保存，运行状态接口不会返回完整配置或项目环境值。
- `preload.js` 及其 `preload/` 模块会使用 Node.js 能力访问本地项目目录、启动 / 停止命令、读取文件、执行 Git 命令和检测开发工具版本。
- Git 写操作仅围绕本地工作区展开，例如暂存、撤销、提交、切换分支、cherry-pick / revert；使用前建议确认当前工作区状态。
- AI 分析会把选定的 Git 信息或 diff 发送给你配置的模型提供方；涉及私有项目时请先确认模型与接口策略。

## 版本历程

- **v1.7.7**：项目启动服务已发布 Release，支持设置页下载并安装、检查更新、验证本地安装与可配置日志保留；定时任务支持立即执行、提前执行和持续运行脚本。
- **v1.7.7**：Git 远端操作增加实时进度，完善当前 HEAD 标签推送、提交树标签操作和分离 HEAD 菜单。
- **v1.7.5**：Git 按需状态刷新、提交短哈希与筛选、远端分支管理、多远程发布修复、提交 tooltip GitHub 跳转。
- **v1.7.3**：自动识别系统终端和编辑器并提供回退启动、跨平台启动与偏好迁移。
- **v1.7.0**：统一项目卡片状态展示。
- **v1.6.x**：定时任务、外部应用打开器、Git AI 多轮修订、uTools 深色主题联动、环境检测增强等。
- **v1.5.x**：项目启动台、脚本与日志、Git 工作区、备忘待办等基础能力逐步成型。

## 贡献

欢迎提交 Issue 和 Pull Request。提交 PR 时请遵循以下基本要求：

- **分支**：可以从最新的 `master` 切出特性分支。
- **提交信息**：使用 Conventional Commits 风格，例如 `feat:`， `fix:`， `refactor:`， `docs:`， `chore:`。
- **范围**：改动尽量小而聚焦，一个 PR 只解决一个问题；大改动请先开 Issue 讨论。
- **验证**：提交前确保以下检查通过：
  ```bash
  npm run lint
  npm run build
  ```
- **测试**：新增或修改逻辑时尽量补充对应单元测试(位于 `tests/`)。使用 `npm test` 运行全部插件 Vitest 测试；涉及对应模块的改动也请运行相关定向测试或校验脚本，至少确保没有破坏现有测试。
- **描述**：PR 描述中说明改动目的、影响范围，如有截图或复现步骤更佳。

## 适合谁

- 同时维护多个本地项目的开发者。
- 需要频繁切换项目、启动服务和查看日志的人。
- 想把 Git 观察、备忘、待办和环境检查放进一个轻量桌面入口的人。
- 使用 uTools 作为日常启动器，并希望把开发工作流也收进 uTools 的人。
