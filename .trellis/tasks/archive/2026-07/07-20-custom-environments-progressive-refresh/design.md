# 自定义开发环境与增量刷新：技术设计

## Boundaries

该功能沿用现有调用方向：Vue 组件 -> Pinia Store -> `src/lib/projectBridge.ts` -> `window.projectBridge` / `public/preload.js`。组件不直接执行命令或访问持久化。

渲染层共享模型放在 `src/types.ts`。preload 继续拥有内置工具的实际平台命令定义，并通过 bridge 暴露当前平台的只读默认定义，供设置页显示与编辑覆盖；设置页和环境页不再各自维护内置名称常量。

## Data Model

- 保留 `EnvironmentToolKey` 表示固定内置工具。
- 新增 `CustomEnvironmentTool`：稳定 `id`、`name`、`command`、`versionArgs: string[]`、`enabled`。
- 新增 `BuiltinEnvironmentToolOverride`：固定内置 `key`、用户覆盖的 `command` 与 `versionArgs`；名称不进入覆盖数据。
- `EnvironmentPreferences` 扩展 `customTools` 与 `builtinOverrides`，继续保存 `enabledToolKeys`。旧数据缺少新增字段时归一化为空数组；显式空 `enabledToolKeys` 必须保留，以支持只启用自定义环境。
- `EnvironmentToolResult.key` 扩展为稳定字符串 ID：内置项沿用原 key，自定义项使用自身 ID。
- 单项检测请求联合类型包含：无覆盖的内置请求只传 key；有覆盖的内置请求携带固定 key 与经过校验的 command/args；自定义请求传稳定 id、名称、命令和参数数组。
- bridge 新增同步读取当前平台内置定义的接口，返回 key、固定名称、默认 command 与默认 versionArgs。Store 以这些定义作为弹窗默认值和“已修改”比较基准。
- Store 新增按 key 的单项刷新状态记录；全局 `environmentRefreshing` 表示当前刷新批次尚未结束。

## Validation And Persistence

设置页把参数输入解析为 token 数组后调用 Store。Store 是用户输入进入领域状态前的最终校验边界：裁剪文本、拒绝空名称/命令、控制字符和 shell 操作符，并为自定义项生成稳定 ID。默认项名称只读，保存时仅写入 command/args 覆盖；保存值等于平台默认值时删除冗余覆盖。

浏览器 fallback 与 preload 各自对持久化值执行同构归一化，忽略畸形自定义项、未知 key 或危险内置覆盖，并兼容旧版 `{ enabledToolKeys }`。继续使用现有 storage key，避免双 key 迁移；新增字段对旧版本读取是向后兼容的。

新增项默认启用并按创建顺序追加。编辑、删除、禁用、重新启用、保存或恢复内置覆盖时清除对应旧结果；受影响项在下次进入环境页时按需检测。

## Detection Flow

bridge 从整批 `detectEnvironmentTools(keys)` 改为单项 `detectEnvironmentTool(request)` Promise。浏览器 fallback 对单项立即返回“不支持检测”的 typed result；preload 对单项完成版本与路径检测后返回结果。

Store 的刷新动作接收目标 key 集合：

1. 为本批目标设置单项检测中状态；已有结果不清空。
2. 使用最多 4 个 worker 消费目标队列，每个 worker 逐项 await bridge。
3. 每个 Promise 结束时立即 upsert 对应结果并清除该项检测中状态。
4. 单项抛错转换为该项 `error` 结果，不影响队列中的其他项。
5. 全部 worker 结束后关闭全局刷新状态并标记已完成检测。

每项维护请求代次。配置被编辑、删除、禁用或新刷新批次替代时递增代次，迟到结果只有在代次与当前定义仍匹配时才能写回，防止旧命令结果覆盖新配置。

preload 复用现有 `runToolCommand`、5 秒超时、输出解码和 `where` / `which` 路径解析。自定义请求和带覆盖的内置请求在执行前再次校验：原生程序 direct spawn；Windows 无扩展名命令先由 `where.exe` 解析，`.exe` / `.com` 仍 direct spawn，`.cmd` / `.bat` 由显式 `cmd.exe /d /c` 启动且在启动前拒绝 `" & | < > ^ % ! ( )`。只有未覆盖的受信任内置定义保留一般 shell PATH 初始化行为。版本优先取 stdout 第一行，stdout 为空时取 stderr 第一行，以兼容 `java -version` 等工具。

## UI Behavior

设置页用一个紧凑自适应网格渲染所有默认和自定义环境。卡片结构统一为启用复选框、名称、命令摘要和可选小徽标：自定义项显示小型“自定义”，默认项无来源标志，存在覆盖时显示小型“已修改”。环境区右上角并列放置“新增环境”和进入检测页的操作，不再渲染独立自定义分区或空状态。

整张卡片主体可通过点击、Enter 或 Space 打开编辑弹窗；复选框阻止卡片激活，只切换启用状态。默认弹窗名称只读，可编辑 command/args，并在存在覆盖时提供“恢复默认”。自定义弹窗可编辑全部字段，并把删除入口放在弹窗底部；删除仍打开二次确认。卡片表面不放编辑或删除图标。

环境页由统一定义列表渲染内置与已启用自定义项：

- 有旧结果且正在刷新：保留值，状态徽标显示“检测中”。
- 无旧结果且正在刷新：仅该卡片显示骨架。
- 单项完成：该卡片立即切换到最终状态，其他卡片保持原刷新状态。
- 全部完成：刷新按钮停止旋转并恢复可用。

环境卡片沿用现有紧凑网格和字段间距，不扩大固定高度；自定义项名称或命令较长时截断并用 title 提供完整值，避免撑开布局。

## Compatibility And Rollback

- 旧偏好数据自动补 `customTools: []`，内置 key 与默认启用集合保持不变。
- 旧偏好数据同时补 `builtinOverrides: []`；回滚旧版本时该未知字段会被忽略。
- 显式空内置列表不再被错误恢复成默认值。
- 回滚代码后，旧版本会忽略未知 `customTools` 字段，内置配置仍可读取。
- 浏览器预览不执行本机命令，但配置 CRUD、持久化和逐项错误展示仍可验证。

## Risks

- Windows shell 参数处理可能放大命令注入风险：Store 与 preload 双重拒绝 shell 操作符和控制字符，执行协议始终分离 executable 与 args。
- 内置覆盖来自用户输入，绝不能复用未覆盖内置工具的一般 shell-backed 分支；请求 kind/override 必须决定原生 direct spawn 或受限 Windows shim 路径。
- Vue 点击处理器不能把 `refreshEnvironmentTools` 作为裸方法引用，否则框架注入的 `MouseEvent` 会被误当成可选 `targetKeys`；必须显式调用 `refreshEnvironmentTools()`。
- 配置变更与检测返回存在竞态：使用每项请求代次丢弃迟到结果。
- 大量自定义项可能启动过多进程：Store worker 数固定为 4，单项仍沿用 5 秒超时。
