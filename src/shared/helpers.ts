export function formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
}

export function pct(used: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((used / total) * 100);
}

export function formatDuration(ms: number): string {
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

export function formatResetTime(ts: number): string {
    if (ts <= 0) return "--";
    const diff = ts - Date.now();
    if (diff <= 0) return "即将重置";
    return formatDuration(diff);
}
