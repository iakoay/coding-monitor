import type { MiniMaxResult, MiniMaxResp } from '../shared/types';
import { EMPTY_MINIMAX } from '../shared/types';
import { pct } from '../shared/helpers';

export async function fetchMiniMax(key: string | undefined, signal: AbortSignal): Promise<MiniMaxResult> {
    if (!key) return EMPTY_MINIMAX;

    const res = await fetch(
        "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
        { headers: { Authorization: `Bearer ${key}` }, signal }
    );

    if (!res.ok) throw new Error(`MiniMax → HTTP ${res.status}`);

    const data = await res.json() as MiniMaxResp;

    if (!data.model_remains?.length) return EMPTY_MINIMAX;

    const coding = data.model_remains.find(m => m.model_name?.includes("MiniMax-M"));

    if (!coding) return EMPTY_MINIMAX;

    const h5RemainCount = coding.current_interval_usage_count ?? 0;
    const h5Total = coding.current_interval_total_count ?? 1;
    const weekRemainCount = coding.current_weekly_usage_count ?? 0;
    const weekTotal = coding.current_weekly_total_count ?? 1;

    const h5Used = h5Total - h5RemainCount;
    const weekUsed = weekTotal - weekRemainCount;

    return {
        h5Usage: h5Used, h5Total,
        h5Percent: pct(h5Used, h5Total),
        h5Remain: coding.remains_time ?? 0,
        weekUsage: weekUsed, weekTotal,
        weekPercent: pct(weekUsed, weekTotal),
        h5RemainCount, weekRemainCount,
    };
}
