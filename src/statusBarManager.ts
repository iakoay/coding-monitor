import * as vscode from 'vscode';
import type { CombinedState, ContextInfo, MiniMaxResult, GLMResult, SessionHealth } from './shared/types';
import { formatTokens } from './shared/helpers';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private lastNotifiedThreshold = 0;
    private clickTimer: NodeJS.Timeout | undefined;
    private clickCount = 0;

    constructor() {
        const cfg = vscode.workspace.getConfiguration('codingMonitor');
        const alignment = cfg.get<string>('statusBarAlignment', 'right');
        const priority = cfg.get<number>('statusBarPriority', 100);

        this.statusBarItem = vscode.window.createStatusBarItem(
            alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
            priority
        );
        this.statusBarItem.command = 'codingMonitor.statusBarClick';
        this.statusBarItem.text = '$(hubot) --   $(minimax-icon) --%   $(zhipu-icon) --%';
        this.statusBarItem.tooltip = 'Click: Refresh · Double-click: Details';
        this.statusBarItem.show();
    }

    updatePosition(): void {
        const cfg = vscode.workspace.getConfiguration('codingMonitor');
        const alignment = cfg.get<string>('statusBarAlignment', 'right');
        const priority = cfg.get<number>('statusBarPriority', 100);

        this.statusBarItem.dispose();
        this.statusBarItem = vscode.window.createStatusBarItem(
            alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
            priority
        );
        this.statusBarItem.command = 'codingMonitor.statusBarClick';
        this.statusBarItem.tooltip = 'Click: Refresh · Double-click: Details';
        this.statusBarItem.show();
    }

    update(state: CombinedState): void {
        const config = vscode.workspace.getConfiguration('claudeContext');
        const showPercentage = config.get<boolean>('showPercentage', true);
        const warningThreshold = config.get<number>('warningThreshold', 70);
        const criticalThreshold = config.get<number>('criticalThreshold', 90);

        // Build Claude segment
        const claudeSegment = this.buildClaudeSegment(state.claude.info, state.health, showPercentage);

        // Build API segments
        const minimaxSegment = this.buildMiniMaxSegment(state.minimax, state.apiErrors.minimax);
        const glmSegment = this.buildGLMSegment(state.glm, state.apiErrors.glm);

        // Assemble text
        if (state.health === 'frozen' || state.health === 'api_error') {
            this.statusBarItem.text = `$(alert) ${claudeSegment}   ${minimaxSegment}   ${glmSegment}`;
        } else {
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

    setLoading(): void {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        this.statusBarItem.tooltip = new vscode.MarkdownString('$(loading~spin) Refreshing...', true);
    }

    clearLoading(): void {
        this.statusBarItem.backgroundColor = undefined;
    }

    private buildClaudeSegment(info: ContextInfo | null, health: SessionHealth, showPercentage: boolean): string {
        if (health === 'frozen') return 'FROZEN';
        if (health === 'api_error') return 'API_ERR';
        if (!info) return '--';

        if (showPercentage) {
            return `${info.percentage.toFixed(1)}%`;
        }
        return `${formatTokens(info.usedTokens)}/${formatTokens(info.maxTokens)}`;
    }

    private buildMiniMaxSegment(data: MiniMaxResult, failed: boolean): string {
        if (failed) return '$(minimax-icon) err';
        if (data.h5Total <= 0) return '$(minimax-icon) --%';
        return `$(minimax-icon) ${data.h5Percent}%`;
    }

    private buildGLMSegment(data: GLMResult, failed: boolean): string {
        if (failed) return '$(zhipu-icon) err';
        if (data.tokens5h <= 0) return '$(zhipu-icon) --%';
        return `$(zhipu-icon) ${data.tokens5h}%`;
    }

    private resolveBackgroundColor(state: CombinedState, warningThreshold: number, criticalThreshold: number): vscode.ThemeColor | undefined {
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

    private resolveForegroundColor(state: CombinedState): vscode.ThemeColor | undefined {
        const maxApiPct = Math.max(state.minimax.h5Percent, state.glm.tokens5h);
        if (maxApiPct >= 95) {
            return new vscode.ThemeColor('errorForeground');
        } else if (maxApiPct >= 80) {
            return new vscode.ThemeColor('editorWarning.foreground');
        }
        return undefined;
    }

    private buildTooltip(state: CombinedState): vscode.MarkdownString {
        const parts: string[] = [];

        // Health warning
        if (state.health === 'frozen' || state.health === 'api_error') {
            parts.push(`**⚠ ${state.health.toUpperCase()}** — ${state.healthReason}\n\n---\n\n`);
        }

        // Claude section
        if (state.claude.info) {
            const info = state.claude.info;
            parts.push(
                `### Claude Code Context\n\n` +
                `- **Model:** ${info.model}\n` +
                `- **Used:** ${formatTokens(info.usedTokens)} / ${formatTokens(info.maxTokens)} tokens\n` +
                `- **Usage:** ${info.percentage.toFixed(2)}%\n` +
                `- **Input:** ${formatTokens(info.inputTokens)} | **Cache:** ${formatTokens(info.cacheReadTokens)}\n` +
                `- **Session:** ${info.sessionId.substring(0, 8)}...\n` +
                `- **Updated:** ${info.lastUpdated.toLocaleTimeString()}\n\n`
            );
        } else if (state.claude.error) {
            parts.push(`### Claude Code\n\nError: ${state.claude.error}\n\n`);
        }

        parts.push('---\n\n');

        // MiniMax section
        const mm = state.minimax;
        parts.push(
            `### MiniMax\n\n` +
            `**5h:** ${mm.h5Usage}/${mm.h5Total} · ${this.fmtDuration(mm.h5Remain)} to reset  \n` +
            `**Week:** ${mm.weekUsage}/${mm.weekTotal}\n\n`
        );

        parts.push('---\n\n');

        // GLM section
        const glm = state.glm;
        const mcpNameMap: Record<string, string> = {
            "search-prime": "Search",
            "web-reader": "Web Reader",
            "zread": "Docs",
        };
        parts.push(
            `### GLM${glm.level ? ` (${glm.level})` : ""}\n\n` +
            `**5h:** ${glm.tokens5h}% · ${this.fmtResetTime(glm.tokens5hReset)} to reset  \n` +
            `**Week:** ${glm.tokensWeek}%  \n` +
            `**MCP:** ${glm.time5hUsed}/${glm.time5hTotal} · ${this.fmtResetTime(glm.nextReset5h)} to reset  \n` +
            (glm.mcpUsage.length > 0
                ? glm.mcpUsage.map(d => `　**${mcpNameMap[d.modelCode] ?? d.modelCode}:** ${d.usage}`).join("  \n") + "  \n"
                : "")
        );

        parts.push(`\n---\n\n_Updated at ${new Date().toLocaleTimeString()}_`);

        return new vscode.MarkdownString(parts.join(''), true);
    }

    private fmtDuration(ms: number): string {
        if (ms <= 0) return "--";
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

    private fmtResetTime(ts: number): string {
        if (ts <= 0) return "--";
        const diff = ts - Date.now();
        if (diff <= 0) return "reset soon";
        return this.fmtDuration(diff);
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
