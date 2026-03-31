import type { LogEntry, LogLevel } from './shared/types';

export class EventLogger {
    private logs: LogEntry[] = [];
    private maxLogs = 200;
    private listeners: Set<(logs: LogEntry[]) => void> = new Set();

    log(level: LogLevel, source: string, message: string): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            source,
            message
        };
        this.logs.unshift(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
        this.notifyListeners();
    }

    info(source: string, message: string): void {
        this.log('info', source, message);
    }

    warning(source: string, message: string): void {
        this.log('warning', source, message);
    }

    error(source: string, message: string): void {
        this.log('error', source, message);
    }

    success(source: string, message: string): void {
        this.log('success', source, message);
    }

    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    clear(): void {
        this.logs = [];
        this.notifyListeners();
    }

    subscribe(listener: (logs: LogEntry[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        const logs = this.getLogs();
        this.listeners.forEach(fn => fn(logs));
    }
}

export const eventLogger = new EventLogger();
