"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTokens = formatTokens;
exports.pct = pct;
exports.formatDuration = formatDuration;
exports.formatResetTime = formatResetTime;
function formatTokens(tokens) {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(1)}M`;
    }
    else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
}
function pct(used, total) {
    if (total <= 0)
        return 0;
    return Math.round((used / total) * 100);
}
function formatDuration(ms) {
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
function formatResetTime(ts) {
    if (ts <= 0)
        return "--";
    const diff = ts - Date.now();
    if (diff <= 0)
        return "即将重置";
    return formatDuration(diff);
}
//# sourceMappingURL=helpers.js.map