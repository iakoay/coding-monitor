"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMiniMax = fetchMiniMax;
const types_1 = require("../shared/types");
const helpers_1 = require("../shared/helpers");
async function fetchMiniMax(key, signal) {
    if (!key)
        return types_1.EMPTY_MINIMAX;
    const res = await fetch("https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains", { headers: { Authorization: `Bearer ${key}` }, signal });
    if (!res.ok)
        throw new Error(`MiniMax → HTTP ${res.status}`);
    const data = await res.json();
    if (!data.model_remains?.length)
        return types_1.EMPTY_MINIMAX;
    const coding = data.model_remains.find(m => m.model_name?.includes("MiniMax-M"));
    if (!coding)
        return types_1.EMPTY_MINIMAX;
    const h5RemainCount = coding.current_interval_usage_count ?? 0;
    const h5Total = coding.current_interval_total_count ?? 1;
    const weekRemainCount = coding.current_weekly_usage_count ?? 0;
    const weekTotal = coding.current_weekly_total_count ?? 1;
    const h5Used = h5Total - h5RemainCount;
    const weekUsed = weekTotal - weekRemainCount;
    return {
        h5Usage: h5Used, h5Total,
        h5Percent: (0, helpers_1.pct)(h5Used, h5Total),
        h5Remain: coding.remains_time ?? 0,
        weekUsage: weekUsed, weekTotal,
        weekPercent: (0, helpers_1.pct)(weekUsed, weekTotal),
        h5RemainCount, weekRemainCount,
    };
}
//# sourceMappingURL=minimaxFetcher.js.map