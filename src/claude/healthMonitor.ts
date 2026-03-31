import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileReader } from './fileReader';
import { DiagnosticsCollector } from './diagnosticsCollector';
import type { SessionHealth, HealthCheckResult } from '../shared/types';

export type { SessionHealth, HealthCheckResult };

export class HealthMonitor {
    private checkTimer: NodeJS.Timeout | null = null;
    private lastState: SessionHealth = 'no_session';
    private notified = false;
    private fileReader: FileReader;
    private collector: DiagnosticsCollector;
    private onStateChange: (state: SessionHealth, reason: string) => void;

    private readonly CLAUDE_DIR = path.join(os.homedir(), '.claude');
    private readonly PROJECTS_DIR = path.join(this.CLAUDE_DIR, 'projects');
    private readonly IDE_DIR = path.join(this.CLAUDE_DIR, 'ide');

    constructor(
        private outputChannel: vscode.OutputChannel,
        private readonly getSessionFile: () => string | null,
        onStateChange: (state: SessionHealth, reason: string) => void
    ) {
        this.fileReader = new FileReader();
        this.collector = new DiagnosticsCollector(outputChannel);
        this.onStateChange = onStateChange;
    }

    start() {
        const config = vscode.workspace.getConfiguration('claudeContext');
        const interval = config.get<number>('freezeCheckInterval', 10000);
        this.checkTimer = setInterval(() => this.check(), interval);
    }

    stop() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }

    private check() {
        const result = this.analyze();

        if (result.state === 'frozen' && this.lastState !== 'frozen') {
            this.onFreezeDetected(result);
        } else if (result.state === 'api_error' && this.lastState !== 'api_error') {
            this.onApiError(result);
        } else if (result.state === 'healthy' && (this.lastState === 'frozen' || this.lastState === 'api_error')) {
            this.onRecovered(result);
        }

        this.lastState = result.state;
        this.onStateChange(result.state, result.reason);
    }

    private analyze(): HealthCheckResult {
        const sessionFile = this.getSessionFile();

        const noSession: HealthCheckResult = {
            state: 'no_session', reason: 'No active session',
            sessionId: '', lastAssistantStopReason: null,
            lastAssistantTimestamp: null, fileMtime: 0, fileAgeMs: Infinity,
            hasPendingToolUse: false, toolUseId: null
        };

        if (!sessionFile || !fs.existsSync(sessionFile)) {
            return noSession;
        }

        const config = vscode.workspace.getConfiguration('claudeContext');
        const freezeThreshold = config.get<number>('freezeThreshold', 30000);

        const stat = fs.statSync(sessionFile);
        const fileAge = Date.now() - stat.mtimeMs;

        const content = this.fileReader.readFile(sessionFile);
        if (!content) {
            noSession.reason = 'Cannot read session file';
            return noSession;
        }

        const lines = content.split('\n').filter(l => l.trim());
        const tailLines = lines.slice(-30);

        let lastStopReason: string | null = null;
        let lastAssistantTimestamp: string | null = null;
        let lastToolUseId: string | null = null;
        let lastAssistantModel: string | null = null;
        let isApiError = false;
        let sessionId = '';

        for (let i = tailLines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(tailLines[i]);
                if (!sessionId && entry.sessionId) { sessionId = entry.sessionId; }

                if (entry.type === 'assistant' && entry.message?.stop_reason != null) {
                    lastStopReason = entry.message.stop_reason;
                    lastAssistantTimestamp = entry.timestamp || null;
                    lastAssistantModel = entry.message.model || null;

                    if (lastAssistantModel === '<synthetic>' && entry.message.isApiErrorMessage) {
                        isApiError = true;
                    }

                    if (lastStopReason === 'tool_use' && Array.isArray(entry.message.content)) {
                        for (const block of entry.message.content) {
                            if (block.type === 'tool_use') {
                                lastToolUseId = block.id;
                                break;
                            }
                        }
                    }
                    break;
                }
            } catch { /* skip */ }
        }

        const result: HealthCheckResult = {
            state: 'healthy', reason: '',
            sessionId: sessionId || path.basename(sessionFile, '.jsonl'),
            lastAssistantStopReason: lastStopReason,
            lastAssistantTimestamp: lastAssistantTimestamp,
            fileMtime: stat.mtimeMs, fileAgeMs: fileAge,
            hasPendingToolUse: lastToolUseId != null,
            toolUseId: lastToolUseId
        };

        if (isApiError) {
            result.state = 'api_error';
            result.reason = 'API error detected (synthetic error message)';
            return result;
        }

        if (lastStopReason === null) {
            if (fileAge > 60000 && this.isClaudeProcessAlive()) {
                result.state = 'frozen';
                result.reason = 'No assistant stop_reason found, file stale >60s';
                return result;
            }
            result.state = 'no_session';
            result.reason = 'No complete assistant message found';
            return result;
        }

        if (lastStopReason === 'end_turn') {
            result.state = 'healthy';
            result.reason = 'Assistant ended turn, waiting for user';
            return result;
        }

        if (lastStopReason === 'stop_sequence' && lastAssistantModel !== '<synthetic>') {
            result.state = 'healthy';
            result.reason = 'Stop sequence (normal)';
            return result;
        }

        if (lastStopReason === 'tool_use' && lastToolUseId) {
            const hasResult = this.hasToolResult(tailLines, lastToolUseId);
            if (hasResult) {
                result.state = 'healthy';
                result.reason = 'Tool use completed';
                return result;
            }

            if (fileAge > freezeThreshold) {
                result.state = 'frozen';
                result.reason = `Tool use "${lastToolUseId}" pending >${Math.round(freezeThreshold / 1000)}s, no result`;
                return result;
            }

            result.state = 'tool_pending';
            result.reason = `Tool use "${lastToolUseId}" executing (${Math.round(fileAge / 1000)}s ago)`;
            return result;
        }

        result.state = 'healthy';
        result.reason = 'Normal state';
        return result;
    }

    private hasToolResult(lines: string[], toolUseId: string): boolean {
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'user' && Array.isArray(entry.message?.content)) {
                    for (const block of entry.message.content) {
                        if (block.tool_use_id === toolUseId) {
                            return true;
                        }
                    }
                }
            } catch { /* skip */ }
        }
        return false;
    }

    private isClaudeProcessAlive(): boolean {
        try {
            const lockFiles = fs.readdirSync(this.IDE_DIR).filter(f => f.endsWith('.lock'));
            return lockFiles.length > 0;
        } catch {
            return false;
        }
    }

    private onFreezeDetected(result: HealthCheckResult) {
        this.notified = true;
        this.collector.collect(result);

        vscode.window.showWarningMessage(
            `Claude Code may be frozen! (${result.reason})`,
            'View Details', 'Dismiss'
        ).then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show(true);
            }
        });
    }

    private onApiError(result: HealthCheckResult) {
        this.collector.collect(result);

        vscode.window.showErrorMessage(
            `Claude Code API Error detected!`,
            'View Details', 'Dismiss'
        ).then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show(true);
            }
        });
    }

    private onRecovered(_result: HealthCheckResult) {
        this.notified = false;

        this.outputChannel.appendLine(`[${new Date().toISOString()}] Claude Code recovered from ${this.lastState}`);
        vscode.window.showInformationMessage('Claude Code has recovered.');
    }
}
