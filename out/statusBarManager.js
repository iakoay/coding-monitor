"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
const helpers_1 = require("./shared/helpers");
const eventLogger_1 = require("./eventLogger");
class StatusBarManager {
    constructor() {
        this.lastNotifiedThreshold = 0;
        this.clickCount = 0;
        this.scrollIndex = 0;
        this.importantLogs = [];
        const cfg = vscode.workspace.getConfiguration('codingMonitor');
        const alignment = cfg.get('statusBarAlignment', 'right');
        const priority = cfg.get('statusBarPriority', 100);
        const isLeft = alignment === 'left';
        this.statusBarItem = vscode.window.createStatusBarItem(isLeft ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, priority);
        this.statusBarItem.command = 'codingMonitor.statusBarClick';
        this.statusBarItem.text = '$(hubot) --   $(minimax-icon) --%   $(zhipu-icon) --%';
        this.statusBarItem.tooltip = '单击刷新 · 双击打开详情';
        this.statusBarItem.show();
        // Log ticker bar — sits just inside the main bar
        this.logBarItem = vscode.window.createStatusBarItem(isLeft ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, isLeft ? priority - 1 : priority - 1);
        this.logBarItem.command = 'codingMonitor.showDetails';
        this.logBarItem.hide();
        // Subscribe to log changes
        eventLogger_1.eventLogger.subscribe(() => this.refreshLogTicker());
        // Start scroll timer (every 4s rotate)
        this.scrollTimer = setInterval(() => this.rotateLog(), 4000);
    }
    updatePosition() {
        const cfg = vscode.workspace.getConfiguration('codingMonitor');
        const alignment = cfg.get('statusBarAlignment', 'right');
        const priority = cfg.get('statusBarPriority', 100);
        const isLeft = alignment === 'left';
        this.statusBarItem.dispose();
        this.statusBarItem = vscode.window.createStatusBarItem(isLeft ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, priority);
        this.statusBarItem.command = 'codingMonitor.statusBarClick';
        this.statusBarItem.tooltip = '单击刷新 · 双击打开详情';
        this.statusBarItem.show();
        this.logBarItem.dispose();
        this.logBarItem = vscode.window.createStatusBarItem(isLeft ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, isLeft ? priority - 1 : priority - 1);
        this.logBarItem.command = 'codingMonitor.showDetails';
        if (this.importantLogs.length > 0) {
            this.logBarItem.show();
        }
        this.refreshLogTicker();
    }
    refreshLogTicker() {
        this.importantLogs = eventLogger_1.eventLogger.getLogs().filter(l => l.level === 'error' || l.level === 'warning');
        if (this.importantLogs.length === 0) {
            this.logBarItem.hide();
            return;
        }
        if (this.scrollIndex >= this.importantLogs.length) {
            this.scrollIndex = 0;
        }
        this.renderCurrentLog();
        this.logBarItem.show();
    }
    rotateLog() {
        if (this.importantLogs.length <= 1)
            return;
        this.scrollIndex = (this.scrollIndex + 1) % this.importantLogs.length;
        this.renderCurrentLog();
    }
    renderCurrentLog() {
        const log = this.importantLogs[this.scrollIndex];
        if (!log)
            return;
        const icon = log.level === 'error' ? '$(error)' : '$(warning)';
        const time = new Date(log.timestamp).toLocaleTimeString();
        const msg = log.message.length > 60 ? log.message.substring(0, 57) + '...' : log.message;
        this.logBarItem.text = `${icon} [${log.source}] ${msg}`;
        this.logBarItem.tooltip = new vscode.MarkdownString(`**${log.level.toUpperCase()}** ${time} [${log.source}]\n\n${log.message}`, true);
        if (log.level === 'error') {
            this.logBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        else {
            this.logBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    }
    update(state) {
        const config = vscode.workspace.getConfiguration('claudeContext');
        const showPercentage = config.get('showPercentage', true);
        const warningThreshold = config.get('warningThreshold', 70);
        const criticalThreshold = config.get('criticalThreshold', 90);
        // Build Claude segment
        const claudeSegment = this.buildClaudeSegment(state.claude.info, state.health, showPercentage);
        // Build API segments
        const minimaxSegment = this.buildMiniMaxSegment(state.minimax, state.apiErrors.minimax);
        const glmSegment = this.buildGLMSegment(state.glm, state.apiErrors.glm);
        // Assemble text
        if (state.health === 'frozen' || state.health === 'api_error') {
            this.statusBarItem.text = `$(alert) ${claudeSegment}   ${minimaxSegment}   ${glmSegment}`;
        }
        else {
            this.statusBarItem.text = `$(hubot) ${claudeSegment}   ${minimaxSegment}   ${glmSegment}`;
        }
        // All failed
        if (state.apiErrors.minimax && state.apiErrors.glm && !state.claude.info) {
            this.statusBarItem.text = '$(warning) error';
        }
        // Background color priority: frozen > critical > warning > none
        this.statusBarItem.backgroundColor = this.resolveBackgroundColor(state, warningThreshold, criticalThreshold);
        // Foreground color based on API thresholds
        this.statusBarItem.color = this.resolveForegroundColor(state);
        // Tooltip
        this.statusBarItem.tooltip = this.buildTooltip(state);
    }
    setLoading() {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        this.statusBarItem.tooltip = new vscode.MarkdownString('$(loading~spin) 刷新中...', true);
    }
    clearLoading() {
        this.statusBarItem.backgroundColor = undefined;
    }
    buildClaudeSegment(info, health, showPercentage) {
        if (health === 'frozen')
            return '冻结';
        if (health === 'api_error')
            return 'API错误';
        if (!info)
            return '--';
        if (showPercentage) {
            return `${info.percentage.toFixed(1)}%`;
        }
        return `${(0, helpers_1.formatTokens)(info.usedTokens)}/${(0, helpers_1.formatTokens)(info.maxTokens)}`;
    }
    buildMiniMaxSegment(data, failed) {
        if (failed)
            return '$(minimax-icon) err';
        if (data.h5Total <= 0)
            return '$(minimax-icon) --%';
        return `$(minimax-icon) ${data.h5Percent}%`;
    }
    buildGLMSegment(data, failed) {
        if (failed)
            return '$(zhipu-icon) err';
        if (data.tokens5h <= 0)
            return '$(zhipu-icon) --%';
        return `$(zhipu-icon) ${data.tokens5h}%`;
    }
    resolveBackgroundColor(state, warningThreshold, criticalThreshold) {
        // Frozen/API error gets error background
        if (state.health === 'frozen' || state.health === 'api_error') {
            return new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        // Claude critical threshold
        if (state.claude.info && state.claude.info.percentage >= criticalThreshold) {
            return new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        // API critical threshold (95%)
        if (state.minimax.h5Percent >= 95 || state.glm.tokens5h >= 95) {
            return new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        // Claude warning threshold
        if (state.claude.info && state.claude.info.percentage >= warningThreshold) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        // API warning threshold (80%)
        if (state.minimax.h5Percent >= 80 || state.glm.tokens5h >= 80) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        return undefined;
    }
    resolveForegroundColor(state) {
        const maxApiPct = Math.max(state.minimax.h5Percent, state.glm.tokens5h);
        if (maxApiPct >= 95) {
            return new vscode.ThemeColor('errorForeground');
        }
        else if (maxApiPct >= 80) {
            return new vscode.ThemeColor('editorWarning.foreground');
        }
        return undefined;
    }
    buildTooltip(state) {
        const parts = [];
        // Health warning
        if (state.health === 'frozen' || state.health === 'api_error') {
            const label = state.health === 'frozen' ? '冻结' : 'API 错误';
            parts.push(`**⚠ ${label}** — ${state.healthReason}\n\n---\n\n`);
        }
        // Claude section
        if (state.claude.info) {
            const info = state.claude.info;
            parts.push(`### Claude Code 上下文\n\n` +
                `模型　　　　 ${info.model}  \n` +
                `已用　　　　 ${(0, helpers_1.formatTokens)(info.usedTokens)} / ${(0, helpers_1.formatTokens)(info.maxTokens)} tokens  \n` +
                `使用率　　　 ${info.percentage.toFixed(2)}%  \n` +
                `输入 / 缓存　${(0, helpers_1.formatTokens)(info.inputTokens)} / ${(0, helpers_1.formatTokens)(info.cacheReadTokens)}  \n` +
                `会话　　　　 ${info.sessionId.substring(0, 8)}...  \n` +
                `更新　　　　 ${info.lastUpdated.toLocaleTimeString()}\n\n`);
        }
        else if (state.claude.error) {
            parts.push(`### Claude Code\n\n错误：${state.claude.error}\n\n`);
        }
        parts.push('---\n\n');
        // MiniMax section
        const mm = state.minimax;
        parts.push(`### MiniMax\n\n` +
            `5小时　　 ${mm.h5Usage} / ${mm.h5Total}（${this.fmtDuration(mm.h5Remain)} 后重置）  \n` +
            `周额度　　 ${mm.weekUsage} / ${mm.weekTotal}\n\n`);
        parts.push('---\n\n');
        // GLM section
        const glm = state.glm;
        const mcpNameMap = {
            "search-prime": "搜索",
            "web-reader": "网页读取",
            "zread": "文档",
        };
        parts.push(`### GLM${glm.level ? ` (${glm.level})` : ""}\n\n` +
            `5小时　　 ${glm.tokens5h}%（${this.fmtResetTime(glm.tokens5hReset)} 后重置）  \n` +
            `周额度　　 ${glm.tokensWeek}%（${this.fmtResetTime(glm.tokensWeekReset)} 后重置）  \n` +
            `月额度　　 ${glm.time5h}%（${this.fmtResetTime(glm.nextReset5h)} 后重置）  \n` +
            `MCP 工具　 ${glm.time5hUsed} / ${glm.time5hTotal}  \n` +
            (glm.mcpUsage.length > 0
                ? glm.mcpUsage.map(d => `　${mcpNameMap[d.modelCode] ?? d.modelCode}　　 ${d.usage}`).join("  \n") + "  \n"
                : ""));
        parts.push(`\n---\n\n_更新于 ${new Date().toLocaleTimeString()}_`);
        return new vscode.MarkdownString(parts.join(''), true);
    }
    fmtDuration(ms) {
        if (ms <= 0)
            return "--";
        const totalHours = ms / 3600000;
        if (totalHours >= 24) {
            const d = Math.floor(totalHours / 24);
            const h = Math.floor(totalHours % 24);
            return h > 0 ? `${d}d ${h}h` : `${d}d`;
        }
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    fmtResetTime(ts) {
        if (ts <= 0)
            return "--";
        const diff = ts - Date.now();
        if (diff <= 0)
            return "reset soon";
        return this.fmtDuration(diff);
    }
    dispose() {
        if (this.scrollTimer)
            clearInterval(this.scrollTimer);
        this.statusBarItem.dispose();
        this.logBarItem.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBarManager.js.map