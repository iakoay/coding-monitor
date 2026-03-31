"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGLM = fetchGLM;
const types_1 = require("../shared/types");
async function fetchGLM(key, signal) {
    if (!key)
        return types_1.EMPTY_GLM;
    const res = await fetch("https://open.bigmodel.cn/api/monitor/usage/quota/limit", { headers: { Authorization: `Bearer ${key}` }, signal });
    if (!res.ok)
        throw new Error(`GLM → HTTP ${res.status}`);
    const data = await res.json();
    if (!data.data?.limits)
        return { ...types_1.EMPTY_GLM, level: data.data?.level || "" };
    const result = { ...types_1.EMPTY_GLM, level: data.data.level || "" };
    for (const lim of data.data.limits) {
        if (lim.type === "TOKENS_LIMIT" && lim.unit === 3) {
            result.tokens5h = lim.percentage ?? 0;
            result.tokens5hReset = lim.nextResetTime ?? 0;
        }
        else if (lim.type === "TOKENS_LIMIT" && lim.unit === 6) {
            result.tokensWeek = lim.percentage ?? 0;
        }
        else if (lim.type === "TIME_LIMIT" && lim.unit === 5) {
            result.time5h = lim.percentage ?? 0;
            result.time5hRemain = lim.remaining ?? 0;
            result.time5hTotal = lim.usage ?? 0;
            result.time5hUsed = lim.currentValue ?? 0;
            result.nextReset5h = lim.nextResetTime ?? 0;
            result.mcpUsage = lim.usageDetails ?? [];
        }
    }
    return result;
}
//# sourceMappingURL=glmFetcher.js.map