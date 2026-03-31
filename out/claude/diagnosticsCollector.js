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
exports.DiagnosticsCollector = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
class DiagnosticsCollector {
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        this.CLAUDE_DIR = path.join(os.homedir(), '.claude');
        this.FREEZE_LOG = path.join(this.CLAUDE_DIR, 'freeze-log.jsonl');
    }
    collect(result) {
        const ideLocks = this.getIdeLockInfo();
        const processInfo = this.getClaudeProcessInfo(ideLocks);
        const memory = process.memoryUsage();
        const sessionFile = this.findSessionFile();
        const lastEntries = this.getLastEntries(sessionFile);
        const entry = {
            timestamp: new Date().toISOString(),
            state: result.state,
            reason: result.reason,
            sessionId: result.sessionId,
            sessionFileMtime: result.fileMtime ? new Date(result.fileMtime).toISOString() : 'N/A',
            sessionFileAgeMs: result.fileAgeMs,
            lastStopReason: result.lastAssistantStopReason,
            lastAssistantTimestamp: result.lastAssistantTimestamp,
            pendingToolUseId: result.toolUseId,
            ideLockFiles: ideLocks,
            claudeProcessInfo: processInfo,
            extensionHostMemory: memory,
            lastEntries: lastEntries
        };
        this.writeToChannel(entry);
        this.writeToLogFile(entry);
        return entry;
    }
    getIdeLockInfo() {
        const ideDir = path.join(this.CLAUDE_DIR, 'ide');
        try {
            const files = fs.readdirSync(ideDir).filter(f => f.endsWith('.lock'));
            return files.map(f => {
                try {
                    const content = fs.readFileSync(path.join(ideDir, f), 'utf-8');
                    return `${f}: ${content.trim()}`;
                }
                catch {
                    return `${f}: (unreadable)`;
                }
            });
        }
        catch {
            return [];
        }
    }
    getClaudeProcessInfo(lockFiles) {
        let pid = null;
        try {
            if (lockFiles.length > 0) {
                const match = lockFiles[0].match(/"pid"\s*:\s*(\d+)/);
                if (match) {
                    pid = match[1];
                }
            }
        }
        catch { /* ignore */ }
        if (!pid) {
            return null;
        }
        try {
            if (process.platform === 'win32') {
                const output = (0, child_process_1.execSync)(`wmic process where ProcessId=${pid} get Name,ProcessId,WorkingSetSize,CommandLine /format:list 2>nul`, { timeout: 5000, encoding: 'utf-8' });
                const info = { pid };
                for (const line of output.split('\n')) {
                    const [key, value] = line.split('=').map(s => s?.trim());
                    if (key && value) {
                        info[key] = value;
                    }
                }
                return info;
            }
            else {
                const output = (0, child_process_1.execSync)(`ps -p ${pid} -o pid,rss,%cpu,%mem,etime,command 2>/dev/null || echo "process not found"`, { timeout: 5000, encoding: 'utf-8' });
                return { pid, psOutput: output.trim() };
            }
        }
        catch {
            return { pid, status: 'query failed or process gone' };
        }
    }
    findSessionFile() {
        const projectsDir = path.join(this.CLAUDE_DIR, 'projects');
        let latest = null;
        let latestTime = 0;
        try {
            const dirs = fs.readdirSync(projectsDir);
            for (const dir of dirs) {
                const fullDir = path.join(projectsDir, dir);
                if (!fs.statSync(fullDir).isDirectory()) {
                    continue;
                }
                const files = fs.readdirSync(fullDir);
                for (const file of files) {
                    if (file.endsWith('.jsonl')) {
                        const fp = path.join(fullDir, file);
                        const mtime = fs.statSync(fp).mtimeMs;
                        if (mtime > latestTime) {
                            latestTime = mtime;
                            latest = fp;
                        }
                    }
                }
            }
        }
        catch { /* ignore */ }
        return latest;
    }
    getLastEntries(sessionFile) {
        if (!sessionFile) {
            return [];
        }
        try {
            const content = fs.readFileSync(sessionFile, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim()).slice(-5);
            return lines.map(line => {
                try {
                    const e = JSON.parse(line);
                    return {
                        type: e.type || '(none)',
                        timestamp: e.timestamp || null,
                        stopReason: e.message?.stop_reason || null
                    };
                }
                catch {
                    return { type: '(parse error)', timestamp: null, stopReason: null };
                }
            });
        }
        catch {
            return [];
        }
    }
    writeToChannel(entry) {
        const sep = '─'.repeat(60);
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine(`⚠ ${sep}`);
        this.outputChannel.appendLine(`  FREEZE DETECTED at ${entry.timestamp}`);
        this.outputChannel.appendLine(`${sep}`);
        this.outputChannel.appendLine(`  State:     ${entry.state}`);
        this.outputChannel.appendLine(`  Reason:    ${entry.reason}`);
        this.outputChannel.appendLine(`  Session:   ${entry.sessionId}`);
        this.outputChannel.appendLine(`  File Age:  ${Math.round(entry.sessionFileAgeMs / 1000)}s`);
        this.outputChannel.appendLine(`  Last Stop: ${entry.lastStopReason || 'N/A'}`);
        this.outputChannel.appendLine(`  Last Time: ${entry.lastAssistantTimestamp || 'N/A'}`);
        if (entry.pendingToolUseId) {
            this.outputChannel.appendLine(`  Pending Tool: ${entry.pendingToolUseId}`);
        }
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('  Last 5 entries:');
        for (const e of entry.lastEntries) {
            this.outputChannel.appendLine(`    ${e.type} | ${e.timestamp || '-'} | stop: ${e.stopReason || '-'}`);
        }
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine(`  IDE Lock Files: ${entry.ideLockFiles.length > 0 ? entry.ideLockFiles.length + ' found' : 'none'}`);
        if (entry.claudeProcessInfo) {
            this.outputChannel.appendLine(`  Process: ${JSON.stringify(entry.claudeProcessInfo)}`);
        }
        this.outputChannel.appendLine(`  Ext Host Memory: rss=${Math.round(entry.extensionHostMemory.rss / 1024 / 1024)}MB, heap=${Math.round(entry.extensionHostMemory.heapUsed / 1024 / 1024)}MB`);
        this.outputChannel.appendLine(`${sep}`);
        this.outputChannel.appendLine('');
    }
    writeToLogFile(entry) {
        try {
            fs.appendFileSync(this.FREEZE_LOG, JSON.stringify(entry) + '\n');
        }
        catch (e) {
            this.outputChannel.appendLine(`  (Failed to write freeze log: ${e})`);
        }
    }
}
exports.DiagnosticsCollector = DiagnosticsCollector;
//# sourceMappingURL=diagnosticsCollector.js.map