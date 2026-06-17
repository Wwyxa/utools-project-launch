# 修复环境检测：支持 nvm/非标准路径的 node/npm/pnpm/docker

## Goal

修复环境检测功能，使其能够正确检测通过版本管理器（如 nvm、nvm-windows）安装的工具，以及其他需要 shell 环境才能找到的命令行工具。

## Problem

用户反馈在两个平台上都无法检测到已安装的工具：
- macOS：通过 nvm 安装的 node、npm、pnpm、docker 无法检测到（但在终端中可以正常调用）
- Windows：可以在终端中调用的 npm、pnpm 无法检测到

## Root Cause

当前实现位于 [public/preload.js](public/preload.js#L510-L558)：
- `runToolCommand()` 使用 `spawn(command, args)` 直接执行命令
- Windows 下直接 spawn 可能无法解析终端中可用的 `.cmd` 工具和 PATH
- macOS/Linux 下即使使用普通 shell，也可能不会加载 nvm 等版本管理器写入登录/交互 shell 的 PATH
- nvm 等版本管理器通过 shell 初始化脚本设置 PATH，不经过正确的 shell 启动方式就找不到工具

具体代码：
```javascript
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
```

## Requirements

### 1. 启用平台感知 shell 环境检测
- Windows 使用 `shell: true` 让 `cmd.exe`/`ComSpec` 按终端 PATH 解析 npm、pnpm 等命令
- macOS/Linux 使用用户 shell 执行命令；非 `sh` shell 以登录/交互方式启动，以加载 nvm、版本管理器等初始化脚本
- shell 命令行参数必须安全引用，避免参数被 shell 重新解释

### 2. 保持现有功能
- 保持超时机制（5 秒）
- 保持错误处理逻辑
- 保持输出解码逻辑
- 保持 Windows 的 `windowsHide: true` 选项

### 3. 验证修复效果
- macOS + nvm 安装的工具能够检测到
- Windows + 标准安装的工具能够检测到
- 错误处理和超时机制正常工作

### 4. 优化开发环境卡片展示
- 卡片标题不重复显示工具名称和工具 key
- 骨架态和结果态保持一致的卡片头部布局
- 保留状态徽章、版本、路径、检测时间和错误信息展示

## Implementation

修改 [public/preload.js](public/preload.js#L510-L558) 中的 `runToolCommand` 函数：

```javascript
const child =
  process.platform === "win32"
    ? spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: true })
    : spawn(shellPath, [shellName === "sh" ? "-lc" : "-ilc", commandLine], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
```

## Acceptance Criteria

- [x] 修改 `runToolCommand` 函数，使用平台感知 shell 启动
- [x] 保留 5 秒超时、输出解码和错误处理
- [x] 优化环境卡片头部，移除重复工具 key 行
- [x] 通过 `npm run lint`
- [x] 通过 `npm run build`
- [ ] 在 macOS + nvm 环境下手动测试 node/npm/pnpm 检测
- [ ] 在 Windows 环境下手动测试 npm/pnpm 检测

## Definition of Done

- 代码修改完成并通过 lint/typecheck
- 用户反馈问题得到验证和解决
- 无新增安全风险（命令和参数都是硬编码的）

## Out of Scope

- 不修改工具定义列表（`environmentTools`）
- 不改变检测逻辑流程（仍然是 version + path 两步）
- 不添加自定义 PATH 搜索路径配置功能

## Technical Notes

- Windows 上 `shell: true` 会使用 `cmd.exe`（或 `process.env.ComSpec`）
- macOS/Linux 上优先使用 `process.env.SHELL`，普通 `sh` 使用 `-lc`，其他 shell 使用 `-ilc` 加载交互/登录环境
- shell 命令行由硬编码命令和参数组成，并通过 `quoteShellToken` 逐项引用
- 性能影响可忽略：环境检测是按需触发的一次性操作，shell 启动开销可以接受
