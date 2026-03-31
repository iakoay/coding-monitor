# Coding Monitor

VS Code 扩展 — 在状态栏实时监控 Claude Code 上下文用量、MiniMax 和智谱 GLM API 配额。

## 功能

- **Claude Code 上下文监控** — 实时显示上下文窗口使用百分比、token 明细、分类统计
- **MiniMax 配额监控** — 5小时/每周用量、剩余次数、重置倒计时
- **GLM 配额监控** — Token 用量、MCP 工具调用时长、各服务用量明细
- **健康检测** — 自动检测 Claude Code 会话状态、冻结预警
- **统一配置界面** — 可视化设置 API Key、刷新间隔、阈值等所有参数
- **状态栏预警** — 超过阈值自动变色（黄/红），支持通知提醒

## 安装

下载最新的 `.vsix` 文件后：

```bash
code --install-extension coding-monitor-1.0.0.vsix
```

或通过 VS Code 命令面板（`Ctrl+Shift+P`）搜索 `Extensions: Install from VSIX...`。

## 使用

安装后自动激活，状态栏左侧显示实时数据：

```
$(hubot) 32.5%   $(minimax-icon) 45%   $(zhipu-icon) 28%
```

- **点击状态栏** — 打开详情面板（Claude Context / API Quotas / Health / Settings）
- **`Ctrl+Shift+P` → `Coding Monitor: Open Settings`** — 直接打开配置页

## 配置

通过详情面板的 **Settings** 标签页可视化配置，或直接编辑 `settings.json`：

### API Keys

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `codingPlan.minimaxKey` | MiniMax API Key | `""` |
| `codingPlan.glmKey` | 智谱 GLM API Key | `""` |

### Claude Context Monitor

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `claudeContext.refreshInterval` | 刷新间隔（毫秒） | `5000` |
| `claudeContext.showPercentage` | 状态栏显示百分比 | `true` |
| `claudeContext.warningThreshold` | 警告阈值（%） | `70` |
| `claudeContext.criticalThreshold` | 严重阈值（%） | `90` |
| `claudeContext.enableNotifications` | 启用阈值通知 | `true` |
| `claudeContext.freezeCheckInterval` | 冻结检测间隔（毫秒） | `10000` |
| `claudeContext.freezeThreshold` | 冻结判定时间（毫秒） | `30000` |

### Coding Plan Monitor

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `codingPlan.refreshInterval` | API 刷新间隔（秒） | `300` |

## 命令

| 命令 | 说明 |
|------|------|
| `Coding Monitor: Show Details` | 打开详情面板 |
| `Coding Monitor: Open Settings` | 打开配置页面 |
| `Claude Context: Refresh` | 手动刷新 Claude 上下文 |
| `Claude Context: Toggle Auto Refresh` | 开关自动刷新 |
| `Claude Context: Show Freeze Log` | 查看冻结检测日志 |
| `Coding Plan: Refresh Usage` | 手动刷新 API 配额 |

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch

# 打包 .vsix
npx vsce package
```

## License

MIT
