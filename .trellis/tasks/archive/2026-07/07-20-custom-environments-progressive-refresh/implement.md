# 自定义开发环境与增量刷新：实施计划

## Implementation Checklist

- [x] 扩展 `src/types.ts` 中的环境偏好、自定义定义、单项请求、结果 key 和 bridge 合约。
- [x] 新增 renderer 侧内置环境展示定义与自定义参数解析/校验帮助函数，避免设置页和环境页继续维护重复常量。
- [x] 同步更新 `src/lib/projectBridge.ts` 与 `public/preload.js` 的偏好归一化，兼容旧数据、保留显式空内置列表并持久化合法自定义项。
- [x] 将 bridge 检测接口改为单项 Promise；preload 复用现有命令执行、路径解析和 5 秒超时，并在执行前校验自定义请求。
- [x] 在 Pinia Store 中实现自定义项 CRUD/启停、结果失效、四路并发刷新队列、单项状态和请求代次保护。
- [x] 更新设置页环境区域，加入紧凑行式自定义项列表、小型新增/编辑对话框、字段校验、删除确认和无障碍标签，避免大面积空白。
- [x] 更新环境页统一渲染内置/自定义项，并实现“旧值 + 检测中”、逐卡骨架解除和单项完成即时展示。
- [x] 同步中英文 locale 文案，移除被替代且不再引用的旧 key。
- [x] 增加环境 Store/bridge 回归测试，覆盖乱序完成、单项失败、迟到结果、旧偏好归一化和自定义配置往返。

## Unified Settings Follow-up

- [x] 扩展共享类型、偏好归一化与 bridge，加入平台内置默认定义读取和 `builtinOverrides` 兼容持久化。
- [x] 扩展环境请求构造与 preload 单项检测：未覆盖内置项保留 trusted shell，内置覆盖与自定义项校验后使用原生 direct spawn 或受限 Windows shim。
- [x] 在 Store 中实现保存/恢复内置覆盖、结果失效和旧请求代次保护，并将默认定义与自定义项组合为统一设置模型。
- [x] 重构设置页环境区为单一紧凑网格：右上角新增按钮、整卡键盘/点击编辑、复选框独立操作、小型“自定义/已修改”标志。
- [x] 默认弹窗固定名称并支持恢复默认；自定义删除入口移入编辑弹窗并保留二次确认；删除独立自定义分区及死文案。
- [x] 扩展环境聚焦测试，覆盖内置覆盖归一化、保存/恢复、direct 请求、失效结果与旧数据兼容。
- [x] 用浏览器复测常规与窄窗口统一网格、弹窗、键盘交互和无大面积空白。

## Windows CLI And Refresh Follow-up

- [x] 修复刷新按钮把 `MouseEvent` 误传为 `targetKeys`，浏览器刷新后检测时间可更新。
- [x] Windows 自定义/覆盖命令通过 `where.exe` 解析 `.exe` / `.com` / `.cmd` / `.bat`；原生程序保持 direct spawn，CLI shim 使用受限 `cmd.exe`。
- [x] 真实 preload VM 探针确认 `code -v` 返回 `1.128.0` 与 `code.cmd` 路径，并确认 `%PATH%` 在 shim 启动前被拒绝。

## Focused Validation

1. `npm run type-check`
2. `npx vitest run src/lib/environmentTools.test.ts`
3. `node --check public/preload.js`
4. `npm run build`

## Manual Validation

- 浏览器预览：新增、编辑、启停、删除自定义项并刷新页面，确认配置持久化；进入环境页后各项逐个结束“不支持检测”状态。
- uTools：配置一个快速命令和一个接近超时的命令，确认快速项先展示、慢项继续检测，单项失败不阻塞其他项。
- uTools：刷新过程中编辑或禁用某项，确认旧请求返回后不会恢复已失效结果。
- 窄窗口与常规窗口：确认设置表单、环境卡片和头部按钮无大片无效留白、重叠或横向溢出。

## Risk And Rollback Points

- 完成类型与 bridge 合约后先运行 type-check；若消费者范围超出预期，保留旧批量方法并用单项方法渐进迁移。
- 完成 Store 队列后先运行专门测试，再修改 UI；若代次控制失败，不进入组件阶段。
- preload 修改后必须先通过 `node --check`；实际命令检测仅在 uTools 手工验证，不在测试中运行开发机真实命令。
- 持久化继续使用同一 key，回滚无需数据迁移；旧版本会忽略 `customTools`。

## Review Gates

- [x] PRD 验收标准与实现逐项映射，无未授权的项目级配置或完整 shell 模式。
- [x] 浏览器 fallback、TypeScript bridge 和 preload 三处合约在内置覆盖扩展后保持一致。
- [x] 单项刷新状态、全局状态、内置覆盖和迟到结果保护均有测试证据。
- [x] 统一设置网格在常规与窄窗口无大片空白、重叠或横向溢出，并具备键盘与无障碍名称。
- [x] 最后一轮使用 `trellis-check` 执行完整质量检查。
