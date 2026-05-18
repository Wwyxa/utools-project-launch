# 实现新增项目功能

## Goal

让用户可以从当前项目管理器界面新增真实可用的本地项目，而不只是停留在 demo 数据或临时内存表单。新增项目应贴合本地开发场景：选择/填写项目路径、识别常见项目类型、配置启动脚本、环境变量和备忘，并在创建后进入项目详情用于启动脚本、查看 Git 状态和继续编辑。

## What I Already Know

- 用户表示 UI 设计基本完成，可以开始实现具体功能；界面可按功能需要小幅调整。
- 本轮优先从“新增项目”开始。
- 当前 `ProjectFormModal.vue` 已有新增/编辑项目表单 UI，字段包括名称、路径、类型、分支、描述、脚本、环境变量、备忘等。
- 当前 `useStore.ts` 已有 `openCreateProjectForm`、`saveProjectForm`、`deleteProject`、`refreshProjectScripts`、`refreshGitSnapshot` 等前端状态逻辑。
- 当前新增项目只写入 Pinia 内存状态，刷新页面后会丢失。
- `public/preload.js` 当前提供 package scripts 读取、Git 快照读取、命令运行/停止、打开路径/显示文件夹能力；尚未提供项目列表持久化或文件夹选择能力。
- README 描述当前版本目标已包含“项目手动添加、启动/停止命令、Git 只读状态、项目备忘”。

## Assumptions Temporary

- 新增项目 MVP 应保留现有表单结构，不做大范围 UI 重做。
- 项目数据应尽量适配 uTools 插件真实使用环境，而不是只服务浏览器预览。
- 离线浏览器预览仍应可用，不能因为缺少 uTools bridge 而崩溃。

## Open Questions

- 待最终确认后进入实现准备。

## Requirements Evolving

- 用户可以打开新增项目弹窗，填写并保存项目。
- 项目路径应支持通过系统文件夹选择器选择，不能只依赖纯手填。
- 保存后项目出现在列表顶部并自动选中。
- 项目列表首先保存到 uTools 环境中的持久化存储，确保可借助 uTools 的数据同步能力在设备间同步。
- 项目数据需要按“可同步的项目元数据”和“本机设备状态”分层组织，避免不同设备路径、终端偏好、运行状态互相污染。
- 每个项目应保存稳定 ID、名称、路径、类型、描述、脚本、环境变量、备忘、创建/更新时间等元数据。
- 每台设备打开同步来的项目时，如果路径不存在，应标记为需要本机重新定位，而不是直接删除或报错。
- 路径不存在的项目应从常规可用项目列表中收起，放入隐藏/折叠区域，避免影响可用项目的日常使用。
- 路径不存在的项目仍允许编辑路径；当路径改为当前设备上的有效路径后，应重新展示为正常可用项目。
- 提供单个 JSON 配置文件形式的手动导出/导入功能，用于备份、迁移或在 uTools 同步之外转移项目配置。
- 导入/导出项目配置入口应放在设置页，而不是主项目列表界面；按钮图标语义必须正确，导入使用上传/进入语义，导出使用下载/离开语义。
- 导出的 JSON 需要包含 `schemaVersion`，便于未来兼容升级。
- 新增项目应能配置至少一个启动脚本，默认脚本根据项目类型给出合理初值。
- 新增项目时应自动读取本地目录内容并建议项目名称、项目类型、脚本和 Git 分支。
- 自动识别优先读取 `package.json` scripts；存在 package.json 时建议 Node.js 类型，并将 scripts 转为项目脚本。
- 新增项目应支持常见 monorepo / 多目录项目：例如项目根目录下 `frontend` 是 Node 前端、`backend` 是 Python 后端时，应能便捷添加前端和后端启动脚本，并允许每个脚本配置相对工作目录。
- 自动识别应扫描项目根目录下常见子目录（如 `frontend`、`backend`、`client`、`server`、`api`），识别 Node package scripts、Python 入口/常见命令，并生成分组脚本建议。
- 启动命令顺序应可在新增/编辑项目窗口中调整，并按保存顺序在详情页展示。
- 停止脚本不需要配置停止命令；用户主动停止后应展示为已停止，不应显示错误。
- 自动识别应读取 Git 快照，填充当前分支并用于新增后的 Git 面板初始状态。
- 自动识别失败、路径不存在或无权限时，应保留手动填写能力并显示可理解反馈。
- 新增项目可保存描述、分支、环境变量和备忘。
- 新增后应能刷新 package scripts 和 Git 状态，复用现有 bridge 能力。
- 表单应有基础校验，避免空名称、空路径或无效脚本造成不可用项目。
- 新增/编辑项目窗口应改为更高密度、工具型布局，减少嵌套 card 和大面积空白，提高批量配置脚本、环境变量、备忘的效率。

## Acceptance Criteria Evolving

- [ ] 在真实 uTools 环境中新增项目后，关闭/重开插件项目仍存在，并可随 uTools 数据同步机制同步。
- [ ] 新增/编辑时可以点击按钮打开文件夹选择器选择项目路径。
- [ ] 同步到另一台设备但本地路径不存在时，项目仍显示在列表中，并提示需要重新定位路径。
- [ ] 路径不存在的项目默认收起在隐藏/折叠区域，不影响正常项目列表浏览和启动。
- [ ] 用户可以编辑失效项目路径；保存为有效路径后，该项目回到正常项目列表。
- [ ] 用户可以导出单个 JSON 配置文件，并在同一插件中重新导入。
- [ ] 导入/导出入口位于设置页，且图标方向与操作语义一致。
- [ ] 导出的 JSON 包含 `schemaVersion` 和项目配置列表。
- [ ] 导入时对重复项目有合理处理，避免无提示覆盖用户已有配置。
- [ ] 在浏览器预览环境中新增项目至少可在当前会话内工作，并有合理降级。
- [ ] 新增 Node.js 项目时可读取 package.json scripts 并生成可运行脚本。
- [ ] 新增包含 `frontend/package.json` 与 `backend` Python 目录的项目时，自动建议前端脚本 cwd 为 `frontend`、后端脚本 cwd 为 `backend`。
- [ ] 启动命令可上移/下移排序，保存后顺序保持。
- [ ] 用户主动停止运行中的命令后，项目卡片和脚本列表显示已停止；只有异常退出才显示错误。
- [ ] 输入有效本地路径后，表单能自动建议名称、类型、脚本和 Git 分支。
- [ ] 自动识别失败时，用户仍可手动填写并保存项目。
- [ ] 新增/编辑弹窗在常见桌面视口中能同时展示更多字段，减少无意义卡片和空白，脚本列表编辑更紧凑。
- [ ] 新增后项目详情页可启动/停止脚本并查看运行日志。
- [ ] 新增后 Git 面板可刷新并展示当前分支和变更。
- [ ] 表单阻止明显无效输入，并给用户可理解的反馈。
- [ ] `npm run build` 通过。

## Definition of Done Team Quality Bar

- Tests added/updated where appropriate.
- Lint / typecheck / build green.
- Docs/notes updated if behavior changes.
- Rollout/rollback considered if risky.

## Out of Scope Explicit

- Git 提交、推送、拉取等写操作。
- 复杂项目模板生成。
- 自建云同步服务或绕过 uTools 的同步系统。
- 大规模重做整体视觉设计。

## Technical Notes

- Likely frontend files: `src/store/useStore.ts`, `src/components/project/ProjectFormModal.vue`, `src/lib/projectBridge.ts`, `src/types.ts`, `src/lib/i18n.ts`.
- Likely preload files: `public/preload.js`, possibly `src/global.d.ts` for bridge typing.
- Current bridge fallback is safe for browser preview but returns empty package scripts and offline Git snapshot.
- Persistent project storage likely belongs behind `ProjectBridge` so Vue code stays runtime-agnostic.

## Technical Approach

Use a storage boundary in `ProjectBridge` for project persistence. In uTools, the preload layer should read/write project records through uTools-provided persistent storage where available so the project catalog can participate in uTools sync. In browser preview, the fallback bridge can use localStorage or in-memory storage so the UI remains testable.

Store synced project records as portable metadata: ID, display name, project path, kind/type, description, scripts, env entries, memo, createdAt, updatedAt, and schema version. Treat runtime state such as script process IDs, running/stopped status, terminal session output, Git snapshot freshness, and path existence as local/device-derived state.

For cross-device safety, do not assume a synced path exists on the current machine. When a project path cannot be accessed, keep the project record but classify it as unavailable on this device. Unavailable projects should be placed behind a collapsed/hidden section so they do not interrupt daily use of valid local projects. Launch, script refresh, and Git refresh should be disabled or guarded until the path is valid on this device. Editing the path to a valid local path should promote the project back into the normal project list.

During project creation, run best-effort inspection after the user provides a path. Prefer detected facts over generic defaults only when they are confident: package.json scripts imply Node.js; Git snapshot supplies branch; folder basename can suggest the project name when the name is still empty. Inspection errors should not block manual creation.

Path selection should be exposed through `ProjectBridge` so uTools can use a native folder picker while browser fallback can keep manual input. Import/export commands belong in settings-level UI, not the primary dashboard workflow.

For multi-directory projects, path inspection should inspect both the selected root and common child directories. Each detected runnable unit should become a script suggestion with an appropriate `group`, `kind`, and relative `cwd`, rather than forcing users to create separate project records for frontend and backend folders.

## Decision ADR-lite

**Context**: Project configurations need to survive plugin restarts, sync through uTools where possible, and remain understandable when the same synced project list lands on machines with different directory layouts.

**Decision**: Persist synced project metadata through the uTools environment and keep device-specific runtime/path validity separate. Add manual export/import as an explicit backup and migration path.

**Consequences**: This avoids losing project configuration while reducing cross-device confusion. It adds a small amount of schema/versioning and import conflict handling, but keeps future sync behavior predictable.

## Import Export Decision ADR-lite

**Context**: Users need a simple manual backup and migration path in addition to uTools sync.

**Decision**: Use a single JSON configuration file for export/import. Include `schemaVersion` at the top level and store the project configuration list in the file.

**Consequences**: The format is easy to inspect, back up, and troubleshoot. It does not support bundled assets yet, but that is acceptable for the current project configuration scope.

## Auto Detection Decision ADR-lite

**Context**: Users adding local development projects should not have to manually recreate information already present on disk.

**Decision**: Automatically inspect the selected/entered path during creation and suggest project name, type, scripts, and Git branch. Keep manual editing available and make inspection best-effort.

**Consequences**: This makes project creation faster and more realistic. It requires async form state and clear failure feedback, but avoids making path inspection a hard dependency for saving.

## Multi Directory Project Decision ADR-lite

**Context**: Real local projects often have separate frontend and backend folders under one repository root, such as a Node frontend in `frontend` and a Python backend in `backend`.

**Decision**: Treat the selected root as one project and generate grouped script suggestions for recognized child directories. Scripts carry relative `cwd` values like `frontend` or `backend` so launch commands run from the right folder.

**Consequences**: Users can manage a full-stack local project as one dashboard item without manually duplicating project records. Detection remains best-effort and editable.

## Form Density Decision ADR-lite

**Context**: The create/edit modal is a productivity surface. Excess cards and whitespace reduce efficiency when configuring multiple scripts and environment entries.

**Decision**: Use a compact form layout with fewer nested cards, tighter spacing, and denser script/environment editing controls while preserving readability and current visual language.

**Consequences**: The modal becomes better suited to real setup work. UI changes should stay scoped to the modal and avoid a broad redesign.

## Unavailable Project Display Decision ADR-lite

**Context**: uTools sync can bring project records to devices where the original local path does not exist. Those records should not clutter the normal working list, but deleting them would lose useful synced configuration.

**Decision**: Keep unavailable projects in a collapsed/hidden section and allow users to edit their path. Once the path validates on the current device, show the project in the normal list again.

**Consequences**: Daily use stays focused on runnable projects while synced-but-unmapped projects remain recoverable. This requires path availability checks and a UI distinction between available and unavailable projects.
