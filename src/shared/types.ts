// ── Claude Context ────────────────────────────────────

export interface ContextCategory {
    name: string;
    tokens: number;
    percentage: string;
}

export interface ContextInfo {
    usedTokens: number;
    maxTokens: number;
    percentage: number;
    model: string;
    lastUpdated: Date;
    categories: ContextCategory[];
    sessionId: string;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
}

// ── Health Monitor ────────────────────────────────────

export type SessionHealth = 'healthy' | 'tool_pending' | 'frozen' | 'api_error' | 'no_session';

export interface HealthCheckResult {
    state: SessionHealth;
    reason: string;
    sessionId: string;
    lastAssistantStopReason: string | null;
    lastAssistantTimestamp: string | null;
    fileMtime: number;
    fileAgeMs: number;
    hasPendingToolUse: boolean;
    toolUseId: string | null;
}

// ── MiniMax ───────────────────────────────────────────

export interface MiniMaxModelRemains {
    model_name?: string;
    current_interval_usage_count?: number;
    current_interval_total_count?: number;
    current_weekly_usage_count?: number;
    current_weekly_total_count?: number;
    remains_time?: number;
}

export interface MiniMaxResp {
    model_remains?: MiniMaxModelRemains[];
    base_resp?: { status_code: number; status_msg: string };
}

export interface MiniMaxResult {
    h5Usage: number;
    h5Total: number;
    h5Percent: number;
    h5Remain: number;
    weekUsage: number;
    weekTotal: number;
    weekPercent: number;
    h5RemainCount: number;
    weekRemainCount: number;
}

export const EMPTY_MINIMAX: MiniMaxResult = {
    h5Usage: 0, h5Total: 1, h5Percent: 0, h5Remain: 0,
    weekUsage: 0, weekTotal: 1, weekPercent: 0,
    h5RemainCount: 0, weekRemainCount: 0,
};

// ── GLM ───────────────────────────────────────────────

export interface GLMLimit {
    type: "TOKENS_LIMIT" | "TIME_LIMIT";
    unit: number;
    number: number;
    percentage: number;
    usage?: number;
    currentValue?: number;
    remaining?: number;
    nextResetTime: number;
    usageDetails?: { modelCode: string; usage: number }[];
}

export interface GLMData {
    limits: GLMLimit[];
    level: string;
}

export interface GLMResp {
    code: number;
    msg: string;
    data?: GLMData;
    success: boolean;
}

export interface GLMResult {
    tokens5h: number;
    tokens5hReset: number;
    tokensWeek: number;
    time5h: number;
    time5hRemain: number;
    time5hTotal: number;
    time5hUsed: number;
    nextReset5h: number;
    level: string;
    mcpUsage: { modelCode: string; usage: number }[];
}

export const EMPTY_GLM: GLMResult = {
    tokens5h: 0, tokens5hReset: 0, tokensWeek: 0,
    time5h: 0, time5hRemain: 0, time5hTotal: 0, time5hUsed: 0,
    nextReset5h: 0,
    level: "",
    mcpUsage: [],
};

// ── Combined State ────────────────────────────────────

export interface CombinedState {
    claude: {
        info: ContextInfo | null;
        error: string | null;
    };
    health: SessionHealth;
    healthReason: string;
    minimax: MiniMaxResult;
    glm: GLMResult;
    apiErrors: { minimax: boolean; glm: boolean };
}
