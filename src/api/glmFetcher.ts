import type { GLMResult, GLMResp } from '../shared/types';
import { EMPTY_GLM } from '../shared/types';

export async function fetchGLM(key: string | undefined, signal: AbortSignal): Promise<GLMResult> {
    if (!key) return EMPTY_GLM;

    const res = await fetch(
        "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
        { headers: { Authorization: `Bearer ${key}` }, signal }
    );

    if (!res.ok) throw new Error(`GLM → HTTP ${res.status}`);

    const data = await res.json() as GLMResp;

    if (!data.data?.limits) return { ...EMPTY_GLM, level: data.data?.level || "" };

    const result: GLMResult = { ...EMPTY_GLM, level: data.data.level || "" };

    for (const lim of data.data.limits) {
        if (lim.type === "TOKENS_LIMIT" && lim.unit === 3) {
            result.tokens5h = lim.percentage ?? 0;
            result.tokens5hReset = lim.nextResetTime ?? 0;
        } else if (lim.type === "TOKENS_LIMIT" && lim.unit === 6) {
            result.tokensWeek = lim.percentage ?? 0;
        } else if (lim.type === "TIME_LIMIT" && lim.unit === 5) {
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
