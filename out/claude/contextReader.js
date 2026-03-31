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
exports.ContextReader = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
class ContextReader {
    constructor(fileReader) {
        this.fileReader = fileReader;
        this.lastNotifiedThreshold = 0;
    }
    /**
     * Convert a workspace path to the Claude project directory name.
     */
    workspaceToProjectDir(workspacePath) {
        let normalized = workspacePath.replace(/\\/g, '/');
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        let encoded = '';
        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            if (ch === ':') {
                continue;
            }
            else if (ch === '/') {
                encoded += '-';
            }
            else if (ch.charCodeAt(0) > 127) {
                continue;
            }
            else {
                encoded += ch;
            }
        }
        if (!encoded.endsWith('-')) {
            encoded += '-';
        }
        return encoded;
    }
    findMatchingProjectDirs(workspacePath) {
        if (!fs.existsSync(PROJECTS_DIR)) {
            return [];
        }
        const dirs = [];
        const computed = this.workspaceToProjectDir(workspacePath);
        const computedPath = path.join(PROJECTS_DIR, computed);
        if (fs.existsSync(computedPath)) {
            dirs.push(computedPath);
        }
        try {
            const entries = fs.readdirSync(PROJECTS_DIR);
            for (const entry of entries) {
                const fullPath = path.join(PROJECTS_DIR, entry);
                if (fs.statSync(fullPath).isDirectory() && fullPath !== computedPath) {
                    dirs.push(fullPath);
                }
            }
        }
        catch {
            // Ignore
        }
        return dirs;
    }
    findActiveSessionFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const projectDirs = [];
        if (workspaceFolders && workspaceFolders.length > 0) {
            const wsPath = workspaceFolders[0].uri.fsPath;
            const matchedDirs = this.findMatchingProjectDirs(wsPath);
            projectDirs.push(...matchedDirs);
        }
        if (projectDirs.length === 0 && fs.existsSync(PROJECTS_DIR)) {
            try {
                const entries = fs.readdirSync(PROJECTS_DIR);
                for (const entry of entries) {
                    const fullPath = path.join(PROJECTS_DIR, entry);
                    if (fs.statSync(fullPath).isDirectory()) {
                        projectDirs.push(fullPath);
                    }
                }
            }
            catch {
                // Ignore
            }
        }
        let latestFile = null;
        let latestTime = 0;
        for (const dir of projectDirs) {
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    if (file.endsWith('.jsonl')) {
                        const fullPath = path.join(dir, file);
                        const stat = fs.statSync(fullPath);
                        if (stat.mtimeMs > latestTime) {
                            latestTime = stat.mtimeMs;
                            latestFile = fullPath;
                        }
                    }
                }
            }
            catch {
                // Ignore
            }
        }
        return latestFile;
    }
    async getContext() {
        const sessionFile = this.findActiveSessionFile();
        if (!sessionFile) {
            throw new Error('No active Claude Code session found');
        }
        const content = this.fileReader.readFile(sessionFile);
        if (!content) {
            throw new Error('Cannot read session file');
        }
        const allLines = content.split('\n');
        const tailLines = allLines.slice(-50).filter(l => l.trim());
        let latestUsage = null;
        let model = 'unknown';
        let sessionId = '';
        for (let i = tailLines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(tailLines[i]);
                if (!sessionId && entry.sessionId) {
                    sessionId = entry.sessionId;
                }
                if (entry.type === 'assistant' && entry.message?.usage) {
                    const usage = entry.message.usage;
                    const totalInput = (usage.input_tokens || 0) +
                        (usage.cache_read_input_tokens || 0) +
                        (usage.cache_creation_input_tokens || 0);
                    if (totalInput > 0) {
                        latestUsage = {
                            input: usage.input_tokens || 0,
                            cacheRead: usage.cache_read_input_tokens || 0,
                            cacheCreation: usage.cache_creation_input_tokens || 0,
                            output: usage.output_tokens || 0
                        };
                        model = entry.message.model || model;
                        break;
                    }
                }
            }
            catch {
                // Skip malformed lines
            }
        }
        if (!latestUsage) {
            throw new Error('No usage data found in session');
        }
        const usedTokens = latestUsage.input + latestUsage.cacheRead + latestUsage.cacheCreation;
        const modelMaxTokens = {
            'claude-opus-4-6': 200000,
            'claude-sonnet-4-6': 200000,
            'claude-haiku-4-5': 200000,
            'claude-3-5-sonnet': 200000,
            'claude-3-opus': 200000,
        };
        const maxTokens = modelMaxTokens[model] || 200000;
        const percentage = (usedTokens / maxTokens) * 100;
        const categories = this.estimateCategories(usedTokens, maxTokens);
        return {
            usedTokens,
            maxTokens,
            percentage,
            model,
            lastUpdated: new Date(),
            categories,
            sessionId: sessionId || path.basename(sessionFile, '.jsonl'),
            inputTokens: latestUsage.input,
            cacheReadTokens: latestUsage.cacheRead,
            cacheCreationTokens: latestUsage.cacheCreation,
            outputTokens: latestUsage.output
        };
    }
    estimateCategories(totalUsed, maxTokens) {
        const estimatedSystemPrompt = Math.min(6000, Math.max(2000, totalUsed * 0.05));
        const estimatedSystemTools = Math.min(16000, Math.max(8000, totalUsed * 0.1));
        const estimatedMessages = totalUsed - estimatedSystemPrompt - estimatedSystemTools;
        const freeSpace = maxTokens - totalUsed;
        return [
            { name: 'System Prompt', tokens: Math.round(estimatedSystemPrompt), percentage: ((estimatedSystemPrompt / maxTokens) * 100).toFixed(1) + '%' },
            { name: 'System Tools', tokens: Math.round(estimatedSystemTools), percentage: ((estimatedSystemTools / maxTokens) * 100).toFixed(1) + '%' },
            { name: 'Messages', tokens: Math.max(0, Math.round(estimatedMessages)), percentage: ((Math.max(0, estimatedMessages) / maxTokens) * 100).toFixed(1) + '%' },
            { name: 'Free Space', tokens: Math.max(0, Math.round(freeSpace)), percentage: ((Math.max(0, freeSpace) / maxTokens) * 100).toFixed(1) + '%' }
        ];
    }
    checkThresholds(info) {
        const config = vscode.workspace.getConfiguration('claudeContext');
        const enableNotifications = config.get('enableNotifications', true);
        const warningThreshold = config.get('warningThreshold', 70);
        const criticalThreshold = config.get('criticalThreshold', 90);
        if (!enableNotifications) {
            return;
        }
        let message;
        let currentThreshold = 0;
        if (info.percentage >= criticalThreshold && this.lastNotifiedThreshold < criticalThreshold) {
            message = `Claude Code context usage is critical: ${info.percentage.toFixed(1)}%`;
            currentThreshold = criticalThreshold;
        }
        else if (info.percentage >= warningThreshold && this.lastNotifiedThreshold < warningThreshold) {
            message = `Claude Code context usage is high: ${info.percentage.toFixed(1)}%`;
            currentThreshold = warningThreshold;
        }
        if (message && currentThreshold > this.lastNotifiedThreshold) {
            vscode.window.showWarningMessage(message, 'View Details', 'Dismiss').then(selection => {
                if (selection === 'View Details') {
                    vscode.commands.executeCommand('codingMonitor.showDetails');
                }
            });
            this.lastNotifiedThreshold = currentThreshold;
        }
        if (info.percentage < warningThreshold) {
            this.lastNotifiedThreshold = 0;
        }
    }
}
exports.ContextReader = ContextReader;
//# sourceMappingURL=contextReader.js.map