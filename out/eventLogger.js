"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventLogger = exports.EventLogger = void 0;
class EventLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 200;
        this.listeners = new Set();
    }
    log(level, source, message) {
        const entry = {
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
    info(source, message) {
        this.log('info', source, message);
    }
    warning(source, message) {
        this.log('warning', source, message);
    }
    error(source, message) {
        this.log('error', source, message);
    }
    success(source, message) {
        this.log('success', source, message);
    }
    getLogs() {
        return [...this.logs];
    }
    clear() {
        this.logs = [];
        this.notifyListeners();
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notifyListeners() {
        const logs = this.getLogs();
        this.listeners.forEach(fn => fn(logs));
    }
}
exports.EventLogger = EventLogger;
exports.eventLogger = new EventLogger();
//# sourceMappingURL=eventLogger.js.map