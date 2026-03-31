import * as vscode from 'vscode';
import type { CombinedState, ContextInfo, MiniMaxResult, GLMResult } from './shared/types';
import { formatTokens, formatDuration, formatResetTime } from './shared/helpers';

interface ConfigValues {
    // API Keys
    codingPlan_minimaxKey: string;
    codingPlan_glmKey: string;
    // Claude Context
    claudeContext_refreshInterval: number;
    claudeContext_showPercentage: boolean;
    claudeContext_warningThreshold: number;
    claudeContext_criticalThreshold: number;
    claudeContext_enableNotifications: boolean;
    claudeContext_freezeCheckInterval: number;
    claudeContext_freezeThreshold: number;
    // Coding Plan
    codingPlan_refreshInterval: number;
}

export class WebviewPanel {
    private panel: vscode.WebviewPanel | undefined;
    private initialTab: string = 'claude';
    private onConfigSaved: (() => void) | undefined;

    constructor(onConfigSaved?: () => void) {
        this.onConfigSaved = onConfigSaved;
    }

    show(state: CombinedState, tab?: string): void {
        if (tab) {
            this.initialTab = tab;
        }

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.updateContent(state);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'codingMonitorDetails',
            'Coding Monitor',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'saveConfig') {
                await this.handleSaveConfig(msg.values as ConfigValues);
            }
        });

        this.updateContent(state);
    }

    private async handleSaveConfig(values: ConfigValues): Promise<void> {
        try {
            const cfg = vscode.workspace.getConfiguration();

            await cfg.update('codingPlan.minimaxKey', values.codingPlan_minimaxKey, vscode.ConfigurationTarget.Global);
            await cfg.update('codingPlan.glmKey', values.codingPlan_glmKey, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.refreshInterval', values.claudeContext_refreshInterval, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.showPercentage', values.claudeContext_showPercentage, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.warningThreshold', values.claudeContext_warningThreshold, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.criticalThreshold', values.claudeContext_criticalThreshold, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.enableNotifications', values.claudeContext_enableNotifications, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.freezeCheckInterval', values.claudeContext_freezeCheckInterval, vscode.ConfigurationTarget.Global);
            await cfg.update('claudeContext.freezeThreshold', values.claudeContext_freezeThreshold, vscode.ConfigurationTarget.Global);
            await cfg.update('codingPlan.refreshInterval', values.codingPlan_refreshInterval, vscode.ConfigurationTarget.Global);

            this.panel?.webview.postMessage({ type: 'saveResult', success: true });
            this.onConfigSaved?.();
        } catch (e) {
            this.panel?.webview.postMessage({ type: 'saveResult', success: false, error: String(e) });
        }
    }

    private loadConfigValues(): ConfigValues {
        const cfg = vscode.workspace.getConfiguration();
        return {
            codingPlan_minimaxKey: cfg.get<string>('codingPlan.minimaxKey', ''),
            codingPlan_glmKey: cfg.get<string>('codingPlan.glmKey', ''),
            claudeContext_refreshInterval: cfg.get<number>('claudeContext.refreshInterval', 5000),
            claudeContext_showPercentage: cfg.get<boolean>('claudeContext.showPercentage', true),
            claudeContext_warningThreshold: cfg.get<number>('claudeContext.warningThreshold', 70),
            claudeContext_criticalThreshold: cfg.get<number>('claudeContext.criticalThreshold', 90),
            claudeContext_enableNotifications: cfg.get<boolean>('claudeContext.enableNotifications', true),
            claudeContext_freezeCheckInterval: cfg.get<number>('claudeContext.freezeCheckInterval', 10000),
            claudeContext_freezeThreshold: cfg.get<number>('claudeContext.freezeThreshold', 30000),
            codingPlan_refreshInterval: cfg.get<number>('codingPlan.refreshInterval', 300),
        };
    }

    private updateContent(state: CombinedState): void {
        if (!this.panel) return;

        const config = vscode.workspace.getConfiguration('claudeContext');
        const warningThreshold = config.get<number>('warningThreshold', 70);
        const criticalThreshold = config.get<number>('criticalThreshold', 90);

        this.panel.webview.html = this.getHtml(state, warningThreshold, criticalThreshold);
    }

    private getHtml(state: CombinedState, warningThreshold: number, criticalThreshold: number): string {
        const claudeHtml = this.getClaudeTabHtml(state.claude.info, warningThreshold, criticalThreshold);
        const apiHtml = this.getApiTabHtml(state.minimax, state.glm);
        const healthHtml = this.getHealthTabHtml(state);
        const settingsHtml = this.getSettingsTabHtml();
        const initialTab = this.initialTab;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coding Monitor</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .container { max-width: 700px; margin: 0 auto; }
        h1 {
            color: var(--vscode-titleBar-activeForeground);
            margin-bottom: 16px;
        }
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
        }
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
            border-radius: 6px;
            font-size: 14px;
        }
        .tab:hover { color: var(--vscode-foreground); }
        .tab.active {
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: bold;
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .info-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
        }
        .label { color: var(--vscode-descriptionForeground); }
        .value { font-weight: bold; }
        .progress-container { margin: 20px 0; }
        .progress-bar {
            width: 100%; height: 28px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 14px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            border-radius: 14px;
            transition: width 0.5s ease;
            display: flex; align-items: center;
            justify-content: flex-end;
            padding-right: 12px;
            color: white; font-weight: bold; font-size: 13px;
        }
        .percentage-text {
            font-size: 48px; font-weight: bold;
            text-align: center;
            margin: 20px 0;
        }
        .model-badge {
            display: inline-block;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 4px 12px; border-radius: 4px; font-size: 14px;
        }
        table {
            width: 100%; border-collapse: collapse; margin-top: 12px;
        }
        th, td {
            text-align: left; padding: 6px 12px;
        }
        th { color: var(--vscode-descriptionForeground); font-size: 12px; }
        .threshold-info {
            display: flex; justify-content: space-around; margin-top: 20px;
        }
        .threshold-item { text-align: center; padding: 10px; }
        .threshold-value { font-size: 24px; font-weight: bold; }
        .threshold-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .warning { color: #dcdcaa; }
        .critical { color: #f44747; }
        .normal { color: #4ec9b0; }
        .health-status {
            padding: 12px;
            border-radius: 8px;
            margin: 12px 0;
            font-weight: bold;
        }
        .health-ok { background-color: rgba(78, 201, 176, 0.15); color: #4ec9b0; }
        .health-warn { background-color: rgba(220, 221, 170, 0.15); color: #dcdcaa; }
        .health-err { background-color: rgba(244, 71, 71, 0.15); color: #f44747; }
        .refresh-info {
            text-align: center; margin-top: 20px;
            color: var(--vscode-descriptionForeground); font-size: 12px;
        }
        .api-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
        }
        .api-card h3 {
            margin-top: 0;
            margin-bottom: 12px;
        }
        /* Settings form styles */
        .settings-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
        }
        .settings-card h3 {
            margin-top: 0;
            margin-bottom: 12px;
        }
        .form-group {
            margin: 12px 0;
        }
        .form-group label {
            display: block;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
            font-size: 13px;
        }
        .form-group .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .form-group input[type="number"],
        .form-group input[type="password"],
        .form-group input[type="text"] {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 4px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 13px;
            box-sizing: border-box;
        }
        .form-group input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .form-group .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-group .checkbox-row input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--vscode-focusBorder);
        }
        .save-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 24px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 16px;
        }
        .save-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .save-result {
            display: inline-block;
            margin-left: 12px;
            font-size: 13px;
        }
        .save-result.success { color: #4ec9b0; }
        .save-result.error { color: #f44747; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Coding Monitor</h1>

        <div class="tabs">
            <div class="tab${initialTab === 'claude' ? ' active' : ''}" onclick="switchTab('claude')">Claude Context</div>
            <div class="tab${initialTab === 'api' ? ' active' : ''}" onclick="switchTab('api')">API Quotas</div>
            <div class="tab${initialTab === 'health' ? ' active' : ''}" onclick="switchTab('health')">Health</div>
            <div class="tab${initialTab === 'settings' ? ' active' : ''}" onclick="switchTab('settings')">$(gear) Settings</div>
        </div>

        <div id="tab-claude" class="tab-content${initialTab === 'claude' ? ' active' : ''}">
            ${claudeHtml}
        </div>

        <div id="tab-api" class="tab-content${initialTab === 'api' ? ' active' : ''}">
            ${apiHtml}
        </div>

        <div id="tab-health" class="tab-content${initialTab === 'health' ? ' active' : ''}">
            ${healthHtml}
        </div>

        <div id="tab-settings" class="tab-content${initialTab === 'settings' ? ' active' : ''}">
            ${settingsHtml}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function switchTab(name) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + name).classList.add('active');
            event.target.classList.add('active');
        }

        function saveSettings() {
            const values = {
                codingPlan_minimaxKey: document.getElementById('cfg-minimaxKey').value,
                codingPlan_glmKey: document.getElementById('cfg-glmKey').value,
                claudeContext_refreshInterval: Number(document.getElementById('cfg-refreshInterval').value),
                claudeContext_showPercentage: document.getElementById('cfg-showPercentage').checked,
                claudeContext_warningThreshold: Number(document.getElementById('cfg-warningThreshold').value),
                claudeContext_criticalThreshold: Number(document.getElementById('cfg-criticalThreshold').value),
                claudeContext_enableNotifications: document.getElementById('cfg-enableNotifications').checked,
                claudeContext_freezeCheckInterval: Number(document.getElementById('cfg-freezeCheckInterval').value),
                claudeContext_freezeThreshold: Number(document.getElementById('cfg-freezeThreshold').value),
                codingPlan_refreshInterval: Number(document.getElementById('cfg-apiRefreshInterval').value),
            };
            vscode.postMessage({ type: 'saveConfig', values });
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            const el = document.getElementById('save-result');
            if (msg.type === 'saveResult') {
                if (msg.success) {
                    el.textContent = 'Saved!';
                    el.className = 'save-result success';
                } else {
                    el.textContent = 'Error: ' + (msg.error || 'Unknown');
                    el.className = 'save-result error';
                }
                setTimeout(() => { el.textContent = ''; el.className = 'save-result'; }, 3000);
            }
        });
    </script>
</body>
</html>`;
    }

    private getSettingsTabHtml(): string {
        const v = this.loadConfigValues();

        return `
        <form onsubmit="return false;">
        <div class="settings-card">
            <h3>API Keys</h3>
            <div class="form-group">
                <label for="cfg-minimaxKey">MiniMax API Key</label>
                <input type="password" id="cfg-minimaxKey" value="${this.escapeAttr(v.codingPlan_minimaxKey)}" placeholder="输入 MiniMax API Key">
                <div class="hint">用于获取 MiniMax 编码助手用量配额</div>
            </div>
            <div class="form-group">
                <label for="cfg-glmKey">智谱 GLM API Key</label>
                <input type="password" id="cfg-glmKey" value="${this.escapeAttr(v.codingPlan_glmKey)}" placeholder="输入 GLM API Key">
                <div class="hint">用于获取 GLM 编码助手用量配额</div>
            </div>
        </div>

        <div class="settings-card">
            <h3>Claude Context Monitor</h3>
            <div class="form-group">
                <label for="cfg-refreshInterval">刷新间隔（毫秒）</label>
                <input type="number" id="cfg-refreshInterval" value="${v.claudeContext_refreshInterval}" min="1000" step="500">
                <div class="hint">自动刷新上下文使用率的时间间隔，默认 5000ms</div>
            </div>
            <div class="form-group">
                <div class="checkbox-row">
                    <input type="checkbox" id="cfg-showPercentage" ${v.claudeContext_showPercentage ? 'checked' : ''}>
                    <label for="cfg-showPercentage">显示百分比</label>
                </div>
                <div class="hint">状态栏显示百分比（关闭则显示 token 数量）</div>
            </div>
            <div class="form-group">
                <label for="cfg-warningThreshold">警告阈值（%）</label>
                <input type="number" id="cfg-warningThreshold" value="${v.claudeContext_warningThreshold}" min="1" max="100">
                <div class="hint">上下文使用率超过此值时状态栏变黄，默认 70%</div>
            </div>
            <div class="form-group">
                <label for="cfg-criticalThreshold">严重阈值（%）</label>
                <input type="number" id="cfg-criticalThreshold" value="${v.claudeContext_criticalThreshold}" min="1" max="100">
                <div class="hint">上下文使用率超过此值时状态栏变红，默认 90%</div>
            </div>
            <div class="form-group">
                <div class="checkbox-row">
                    <input type="checkbox" id="cfg-enableNotifications" ${v.claudeContext_enableNotifications ? 'checked' : ''}>
                    <label for="cfg-enableNotifications">启用通知</label>
                </div>
                <div class="hint">超过阈值时弹出通知提醒</div>
            </div>
            <div class="form-group">
                <label for="cfg-freezeCheckInterval">冻结检测间隔（毫秒）</label>
                <input type="number" id="cfg-freezeCheckInterval" value="${v.claudeContext_freezeCheckInterval}" min="1000" step="1000">
                <div class="hint">检测 Claude Code 是否冻结的间隔，默认 10000ms</div>
            </div>
            <div class="form-group">
                <label for="cfg-freezeThreshold">冻结判定时间（毫秒）</label>
                <input type="number" id="cfg-freezeThreshold" value="${v.claudeContext_freezeThreshold}" min="5000" step="5000">
                <div class="hint">工具调用超过此时间无响应则判定为冻结，默认 30000ms</div>
            </div>
        </div>

        <div class="settings-card">
            <h3>Coding Plan</h3>
            <div class="form-group">
                <label for="cfg-apiRefreshInterval">API 刷新间隔（秒）</label>
                <input type="number" id="cfg-apiRefreshInterval" value="${v.codingPlan_refreshInterval}" min="30" step="30">
                <div class="hint">MiniMax / GLM 配额数据刷新间隔，默认 300 秒</div>
            </div>
        </div>

        <button type="button" class="save-btn" onclick="saveSettings()">Save</button>
        <span id="save-result" class="save-result"></span>
        </form>`;
    }

    private escapeAttr(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    private getClaudeTabHtml(info: ContextInfo | null, warningThreshold: number, criticalThreshold: number): string {
        if (!info) {
            return `<div class="info-card"><p>No Claude Code session found. Start a Claude Code session to see context usage.</p></div>`;
        }

        const percentage = info.percentage.toFixed(2);
        const barColor = info.percentage >= criticalThreshold ? '#f44747' :
                         info.percentage >= warningThreshold ? '#dcdcaa' : '#4ec9b0';

        const categoryRows = info.categories.map(c =>
            `<tr><td>${c.name}</td><td>${formatTokens(c.tokens)}</td><td>${c.percentage}</td></tr>`
        ).join('\n');

        return `
        <div class="info-card">
            <div class="info-row">
                <span class="label">Model</span>
                <span class="value"><span class="model-badge">${info.model}</span></span>
            </div>
            <div class="info-row">
                <span class="label">Input Tokens (new)</span>
                <span class="value">${info.inputTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Cache Read Tokens</span>
                <span class="value">${info.cacheReadTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Cache Creation Tokens</span>
                <span class="value">${info.cacheCreationTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Output Tokens</span>
                <span class="value">${info.outputTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Total Context Used</span>
                <span class="value">${info.usedTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Max Context Window</span>
                <span class="value">${info.maxTokens.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="label">Remaining</span>
                <span class="value">${(info.maxTokens - info.usedTokens).toLocaleString()}</span>
            </div>
        </div>

        <div class="percentage-text" style="color: ${barColor}">${percentage}%</div>

        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${Math.min(100, info.percentage)}%; background-color: ${barColor}">
                    ${percentage}%
                </div>
            </div>
        </div>

        <div class="info-card">
            <h3>Estimated Usage by Category</h3>
            <table>
                <thead><tr><th>Category</th><th>Tokens</th><th>%</th></tr></thead>
                <tbody>${categoryRows}</tbody>
            </table>
        </div>

        <div class="threshold-info">
            <div class="threshold-item">
                <div class="threshold-value normal">${warningThreshold}%</div>
                <div class="threshold-label">Warning Threshold</div>
            </div>
            <div class="threshold-item">
                <div class="threshold-value warning">${criticalThreshold}%</div>
                <div class="threshold-label">Critical Threshold</div>
            </div>
        </div>

        <div class="refresh-info">
            Session: ${info.sessionId.substring(0, 8)}... | Updated: ${info.lastUpdated.toLocaleString()}
        </div>`;
    }

    private getApiTabHtml(minimax: MiniMaxResult, glm: GLMResult): string {
        const mmBarColor = minimax.h5Percent >= 95 ? '#f44747' :
                          minimax.h5Percent >= 80 ? '#dcdcaa' : '#4ec9b0';
        const glmBarColor = glm.tokens5h >= 95 ? '#f44747' :
                           glm.tokens5h >= 80 ? '#dcdcaa' : '#4ec9b0';

        const mcpNameMap: Record<string, string> = {
            "search-prime": "联网搜索",
            "web-reader": "网页阅读",
            "zread": "文档阅读",
        };

        const mcpRows = glm.mcpUsage.map(d =>
            `<tr><td>${mcpNameMap[d.modelCode] ?? d.modelCode}</td><td>${d.usage}</td></tr>`
        ).join('\n');

        return `
        <div class="api-card">
            <h3>MiniMax</h3>
            <div class="info-row">
                <span class="label">5h Usage</span>
                <span class="value">${minimax.h5Usage} / ${minimax.h5Total}</span>
            </div>
            <div class="info-row">
                <span class="label">5h Remaining</span>
                <span class="value">${minimax.h5RemainCount} (${formatDuration(minimax.h5Remain)} reset)</span>
            </div>
            <div class="info-row">
                <span class="label">Weekly Usage</span>
                <span class="value">${minimax.weekUsage} / ${minimax.weekTotal}</span>
            </div>
            <div class="percentage-text" style="font-size: 32px; color: ${mmBarColor}">${minimax.h5Percent}%</div>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${Math.min(100, minimax.h5Percent)}%; background-color: ${mmBarColor}">
                        ${minimax.h5Percent}%
                    </div>
                </div>
            </div>
        </div>

        <div class="api-card">
            <h3>GLM${glm.level ? ` (${glm.level})` : ''}</h3>
            <div class="info-row">
                <span class="label">5h Token Usage</span>
                <span class="value">${glm.tokens5h}%</span>
            </div>
            <div class="info-row">
                <span class="label">Weekly Token Usage</span>
                <span class="value">${glm.tokensWeek}%</span>
            </div>
            <div class="info-row">
                <span class="label">MCP Time</span>
                <span class="value">${glm.time5hUsed} / ${glm.time5hTotal} (${formatResetTime(glm.nextReset5h)})</span>
            </div>
            ${glm.mcpUsage.length > 0 ? `
            <table>
                <thead><tr><th>Service</th><th>Usage</th></tr></thead>
                <tbody>${mcpRows}</tbody>
            </table>` : ''}
            <div class="percentage-text" style="font-size: 32px; color: ${glmBarColor}">${glm.tokens5h}%</div>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${Math.min(100, glm.tokens5h)}%; background-color: ${glmBarColor}">
                        ${glm.tokens5h}%
                    </div>
                </div>
            </div>
        </div>`;
    }

    private getHealthTabHtml(state: CombinedState): string {
        const healthClass = state.health === 'healthy' || state.health === 'tool_pending' ? 'health-ok' :
                           state.health === 'frozen' ? 'health-err' :
                           state.health === 'api_error' ? 'health-err' : 'health-warn';

        const healthLabel = state.health === 'healthy' ? 'Healthy' :
                           state.health === 'tool_pending' ? 'Tool Pending' :
                           state.health === 'frozen' ? 'FROZEN' :
                           state.health === 'api_error' ? 'API Error' : 'No Session';

        return `
        <div class="health-status ${healthClass}">
            Status: ${healthLabel}
        </div>
        <div class="info-card">
            <div class="info-row">
                <span class="label">State</span>
                <span class="value">${state.health}</span>
            </div>
            <div class="info-row">
                <span class="label">Reason</span>
                <span class="value">${state.healthReason || 'N/A'}</span>
            </div>
        </div>
        <div class="refresh-info">
            Use "Claude Context: Show Freeze Log" command for detailed diagnostics.
        </div>`;
    }
}
