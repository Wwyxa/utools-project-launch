# 扩展 Git 操作能力 - Technical Design

## Architecture

所有新增操作沿用同一跨层路径：

`GitTab / GitChangesPane / GitCommitHistory -> Pinia store -> ProjectBridge -> public/preload.js -> git argv`

- Vue 组件只拥有交互状态、确认弹窗和操作入口，不直接调用 bridge 或 Git。
- Pinia 重新授权当前 `ProjectGitRepositoryTarget`，串行化写操作，并选择正确的刷新范围。
- `ProjectBridge` 在真实 preload 与浏览器 fallback 中保持同一异步类型合同。
- preload 在信任边界验证路径、remote、ref 和提交，再使用参数数组执行 Git；远程命令保持异步、禁用交互式凭据并设置超时。

## Child Task Boundaries

| Child task                         | Ownership                                         | Shared surfaces                              |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `08-05-git-repository-publish`     | 初始化非 Git 项目；首次发布当前分支               | GitTab、remote snapshot、bridge/store 写操作 |
| `08-05-git-last-commit-correction` | amend HEAD；撤销上次提交                          | GitChangesPane、提交草稿、HEAD mutation      |
| `08-05-git-history-actions`        | 单提交 cherry-pick/revert；冲突恢复与外部工具提示 | GitCommitHistory、失败反馈、提示文案         |

父任务不直接修改产品代码。三个子任务依次实施和检查，父任务最后执行跨功能回归。

## Shared Contracts

- 扩展 `ProjectGitActionBlockReason` 时使用封闭 union，不通过本地化错误文案推断行为。
- `ProjectGitActionResult` 只增加多项操作共同需要的可选结果字段；不为单一按钮建立新的结果层级。
- 除 `git init` 外，所有操作都必须在 store 调用 bridge 前重新解析当前 repository target。
- `git init` 是唯一无现成 Git repository context 的写操作：store 从项目记录读取主项目路径，成功后清除旧 Git 协调状态并重新加载 workspace/snapshot。
- ref/HEAD/remote 变化全部走 full refresh 和 shared-ref invalidation；失败但可能改变仓库状态的操作也强制刷新。
- 浏览器 fallback 保留全部新方法并返回 typed unavailable result，保证开发预览不抛错。

## Conflict And Recovery Contract

- cherry-pick/revert 冲突后立即执行对应 `--abort`。
- cherry-pick/revert 失败后返回普通失败结果：abort 成功时说明已恢复，abort 失败时保留原始操作错误和 abort 错误，不新增恢复状态枚举。
- GitCommitHistory 对本次 cherry-pick/revert 失败显示 warning dialog，说明可使用专业 Git 工具，并提示可在外部应用设置中配置后从现有仓库菜单打开；dialog 不调用外部应用。
- 插件不提供 continue、skip、冲突编辑器或通用 operation-state dashboard。

## Compatibility And Migration

- 不新增运行时依赖，不修改持久化项目数据，不需要迁移。
- 新 bridge 方法必须同步更新 shared types、browser fallback 和 preload export。
- 现有 remote、commit、stash、branch/tag 入口及 repository target 行为保持兼容。

## Rollback

- 每个子任务形成独立提交和验证点；失败时只回滚该子任务新增入口与 bridge 方法。
- 不通过删除现有 Git 功能或放宽验证来修复新操作。
- 若某子任务发现 shared contract 不足，先回到 planning 更新父/子设计，再继续后续子任务。
