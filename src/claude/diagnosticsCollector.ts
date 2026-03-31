import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { HealthCheckResult } from '../shared/types';

interface FreezeLogEntry {
    timestamp: string;
    state: string;
    reason: string;
    sessionId: string;
    sessionFileMtime: string;
    sessionFileAgeMs: number;
    lastStopReason: string | null;
    lastAssistantTimestamp: string | null;
    pendingToolUseId: string | null;
    ideLockFiles: string[];
    claudeProcessInfo: Record<string, string> | null;
    extensionHostMemory: NodeJS.MemoryUsage;
    lastEntries: Array<{ type: string; timestamp: string | null; stopReason: string | null }>;
}

export class DiagnosticsCollector {
    private readonly CLAUDE_DIR = path.join(os.homedir(), '.claude');
    private readonly FREEZE_LOG = path.join(this.CLAUDE_DIR, 'freeze-log.jsonl');

    constructor(private outputChannel: vscode.OutputChannel) {}

    collect(result: HealthCheckResult): FreezeLogEntry {
        const ideLocks = this.getIdeLockInfo();
        const processInfo = this.getClaudeProcessInfo(ideLocks);
        const memory = process.memoryUsage();
        const sessionFile = this.findSessionFile();
        const lastEntries = this.getLastEntries(sessionFile);

        const entry: FreezeLogEntry = {
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

    private getIdeLockInfo(): string[] {
        const ideDir = path.join(this.CLAUDE_DIR, 'ide');
        try {
            const files = fs.readdirSync(ideDir).filter(f => f.endsWith('.lock'));
            return files.map(f => {
                try {
                    const content = fs.readFileSync(path.join(ideDir, f), 'utf-8');
                    return `${f}: ${content.trim()}`;
                } catch {
                    return `${f}: (unreadable)`;
                }
            });
        } catch {
            return [];
        }
    }

    private getClaudeProcessInfo(lockFiles: string[]): Record<string, string> | null {
        let pid: string | null = null;
        try {
            if (lockFiles.length > 0) {
                const match = lockFiles[0].match(/"pid"\s*:\s*(\d+)/);
                if (match) { pid = match[1]; }
            }
        } catch { /* ignore */ }

        if (!pid) { return null; }

        try {
            if (process.platform === 'win32') {
                const output = execSync(
                    `wmic process where ProcessId=${pid} get Name,ProcessId,WorkingSetSize,CommandLine /format:list 2>nul`,
                    { timeout: 5000, encoding: 'utf-8' }
                );
                const info: Record<string, string> = { pid };
                for (const line of output.split('\n')) {
                    const [key, value] = line.split('=').map(s => s?.trim());
                    if (key && value) { info[key] = value; }
                }
                return info;
            } else {
                const output = execSync(
                    `ps -p ${pid} -o pid,rss,%cpu,%mem,etime,command 2>/dev/null || echo "process not found"`,
                    { timeout: 5000, encoding: 'utf-8' }
                );
                return { pid, psOutput: output.trim() };
            }
        } catch {
            return { pid, status: 'query failed or process gone' };
        }
    }

    private findSessionFile(): string | null {
        const projectsDir = path.join(this.CLAUDE_DIR, 'projects');
        let latest: string | null = null;
        let latestTime = 0;
        try {
            const dirs = fs.readdirSync(projectsDir);
            for (const dir of dirs) {
                const fullDir = path.join(projectsDir, dir);
                if (!fs.statSync(fullDir).isDirectory()) { continue; }
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
        } catch { /* ignore */ }
        return latest;
    }

    private getLastEntries(sessionFile: string | null): FreezeLogEntry['lastEntries'] {
        if (!sessionFile) { return []; }
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
                } catch {
                    return { type: '(parse error)', timestamp: null, stopReason: null };
                }
            });
        } catch {
            return [];
        }
    }

    private writeToChannel(entry: FreezeLogEntry) {
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

    private writeToLogFile(entry: FreezeLogEntry) {
        try {
            fs.appendFileSync(this.FREEZE_LOG, JSON.stringify(entry) + '\n');
        } catch (e) {
            this.outputChannel.appendLine(`  (Failed to write freeze log: ${e})`);
        }
    }
}
