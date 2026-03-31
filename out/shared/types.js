"use strict";
// ── Claude Context ────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_GLM = exports.EMPTY_MINIMAX = void 0;
exports.EMPTY_MINIMAX = {
    h5Usage: 0, h5Total: 1, h5Percent: 0, h5Remain: 0,
    weekUsage: 0, weekTotal: 1, weekPercent: 0,
    h5RemainCount: 0, weekRemainCount: 0,
};
exports.EMPTY_GLM = {
    tokens5h: 0, tokens5hReset: 0, tokensWeek: 0,
    time5h: 0, time5hRemain: 0, time5hTotal: 0, time5hUsed: 0,
    nextReset5h: 0,
    level: "",
    mcpUsage: [],
};
//# sourceMappingURL=types.js.map