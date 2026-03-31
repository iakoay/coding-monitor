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
exports.HealthMonitor = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fileReader_1 = require("./fileReader");
const diagnosticsCollector_1 = require("./diagnosticsCollector");
class HealthMonitor {
    constructor(outputChannel, getSessionFile, onStateChange) {
        this.outputChannel = outputChannel;
        this.getSessionFile = getSessionFile;
        this.checkTimer = null;
        this.lastState = 'no_session';
        this.notified = false;
        this.CLAUDE_DIR = path.join(os.homedir(), '.claude');
        this.PROJECTS_DIR = path.join(this.CLAUDE_DIR, 'projects');
        this.IDE_DIR = path.join(this.CLAUDE_DIR, 'ide');
        this.fileReader = new fileReader_1.FileReader();
        this.collector = new diagnosticsCollector_1.DiagnosticsCollector(outputChannel);
        this.onStateChange = onStateChange;
    }
    start() {
        const config = vscode.workspace.getConfiguration('claudeContext');
        const interval = config.get('freezeCheckInterval', 10000);
        this.checkTimer = setInterval(() => this.check(), interval);
    }
    stop() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }
    check() {
        const result = this.analyze();
        if (result.state === 'frozen' && this.lastState !== 'frozen') {
            this.onFreezeDetected(result);
        }
        else if (result.state === 'api_error' && this.lastState !== 'api_error') {
            this.onApiError(result);
        }
        else if (result.state === 'healthy' && (this.lastState === 'frozen' || this.lastState === 'api_error')) {
            this.onRecovered(result);
        }
        this.lastState = result.state;
        this.onStateChange(result.state, result.reason);
    }
    analyze() {
        const sessionFile = this.getSessionFile();
        const noSession = {
            state: 'no_session', reason: 'No active session',
            sessionId: '', lastAssistantStopReason: null,
            lastAssistantTimestamp: null, fileMtime: 0, fileAgeMs: Infinity,
            hasPendingToolUse: false, toolUseId: null
        };
        if (!sessionFile || !fs.existsSync(sessionFile)) {
            return noSession;
        }
        const config = vscode.workspace.getConfiguration('claudeContext');
        const freezeThreshold = config.get('freezeThreshold', 30000);
        const stat = fs.statSync(sessionFile);
        const fileAge = Date.now() - stat.mtimeMs;
        const content = this.fileReader.readFile(sessionFile);
        if (!content) {
            noSession.reason = 'Cannot read session file';
            return noSession;
        }
        const lines = content.split('\n').filter(l => l.trim());
        const tailLines = lines.slice(-30);
        let lastStopReason = null;
        let lastAssistantTimestamp = null;
        let lastToolUseId = null;
        let lastAssistantModel = null;
        let isApiError = false;
        let sessionId = '';
        for (let i = tailLines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(tailLines[i]);
                if (!sessionId && entry.sessionId) {
                    sessionId = entry.sessionId;
                }
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
            }
            catch { /* skip */ }
        }
        const result = {
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
    hasToolResult(lines, toolUseId) {
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
            }
            catch { /* skip */ }
        }
        return false;
    }
    isClaudeProcessAlive() {
        try {
            const lockFiles = fs.readdirSync(this.IDE_DIR).filter(f => f.endsWith('.lock'));
            return lockFiles.length > 0;
        }
        catch {
            return false;
        }
    }
    onFreezeDetected(result) {
        this.notified = true;
        this.collector.collect(result);
        vscode.window.showWarningMessage(`Claude Code may be frozen! (${result.reason})`, 'View Details', 'Dismiss').then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show(true);
            }
        });
    }
    onApiError(result) {
        this.collector.collect(result);
        vscode.window.showErrorMessage(`Claude Code API Error detected!`, 'View Details', 'Dismiss').then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show(true);
            }
        });
    }
    onRecovered(_result) {
        this.notified = false;
        this.outputChannel.appendLine(`[${new Date().toISOString()}] Claude Code recovered from ${this.lastState}`);
        vscode.window.showInformationMessage('Claude Code has recovered.');
    }
}
exports.HealthMonitor = HealthMonitor;
//# sourceMappingURL=healthMonitor.js.map