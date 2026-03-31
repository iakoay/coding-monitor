"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fileReader_1 = require("./claude/fileReader");
const contextReader_1 = require("./claude/contextReader");
const healthMonitor_1 = require("./claude/healthMonitor");
const statusBarManager_1 = require("./statusBarManager");
const webviewPanel_1 = require("./webviewPanel");
const minimaxFetcher_1 = require("./api/minimaxFetcher");
const glmFetcher_1 = require("./api/glmFetcher");
const types_1 = require("./shared/types");
let statusBar;
let webviewPanel;
let contextReader;
let healthMonitor;
let outputChannel;
let claudeTimer;
let apiTimer;
let abortController;
let autoRefreshEnabled = true;
// Current combined state
let currentState = {
    claude: { info: null, error: null },
    health: 'no_session',
    healthReason: '',
    minimax: { ...types_1.EMPTY_MINIMAX },
    glm: { ...types_1.EMPTY_GLM },
    apiErrors: { minimax: false, glm: false },
};
function activate(context) {
    console.log('Coding Monitor is now active');
    outputChannel = vscode.window.createOutputChannel('Coding Monitor');
    context.subscriptions.push(outputChannel);
    const fileReader = new fileReader_1.FileReader();
    contextReader = new contextReader_1.ContextReader(fileReader);
    statusBar = new statusBarManager_1.StatusBarManager();
    context.subscriptions.push({ dispose: () => statusBar.dispose() });
    webviewPanel = new webviewPanel_1.WebviewPanel(() => {
        // After config saved in webview, immediately refresh API
        refreshApi();
        refreshClaude();
    });
    // Health monitor with callback
    healthMonitor = new healthMonitor_1.HealthMonitor(outputChannel, () => contextReader.findActiveSessionFile(), (state, reason) => {
        currentState.health = state;
        currentState.healthReason = reason;
        statusBar.update(currentState);
    });
    healthMonitor.start();
    context.subscriptions.push({ dispose: () => healthMonitor.stop() });
    // Commands
    // Single click: refresh, Double click: show details
    let clickTimer;
    context.subscriptions.push(vscode.commands.registerCommand('codingMonitor.statusBarClick', () => {
        if (clickTimer) {
            // Double click
            clearTimeout(clickTimer);
            clickTimer = undefined;
            webviewPanel.show(currentState);
        }
        else {
            // First click — wait to see if double click follows
            clickTimer = setTimeout(() => {
                clickTimer = undefined;
                refreshClaude();
                refreshApi();
            }, 300);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codingMonitor.showDetails', () => {
        webviewPanel.show(currentState);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeContext.refresh', () => refreshClaude()));
    context.subscriptions.push(vscode.commands.registerCommand('claudeContext.toggleAutoRefresh', () => {
        autoRefreshEnabled = !autoRefreshEnabled;
        const status = autoRefreshEnabled ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`Claude Context auto-refresh ${status}`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeContext.showFreezeLog', () => {
        outputChannel.show(true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codingPlan.refresh', () => refreshApi()));
    context.subscriptions.push(vscode.commands.registerCommand('codingMonitor.openSettings', () => {
        webviewPanel.show(currentState, 'settings');
    }));
    // Config change listeners
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeContext.refreshInterval')) {
            startClaudeTimer();
        }
        if (e.affectsConfiguration('codingPlan')) {
            startApiTimer();
        }
    }));
    // Initial refresh
    refreshClaude();
    refreshApi();
    // Start timers
    startClaudeTimer();
    startApiTimer();
}
function startClaudeTimer() {
    if (claudeTimer)
        clearInterval(claudeTimer);
    const config = vscode.workspace.getConfiguration('claudeContext');
    const interval = config.get('refreshInterval', 5000);
    claudeTimer = setInterval(() => {
        if (autoRefreshEnabled) {
            refreshClaude();
        }
    }, interval);
}
function startApiTimer() {
    if (apiTimer)
        clearInterval(apiTimer);
    abortInFlight();
    const config = vscode.workspace.getConfiguration('codingPlan');
    const interval = config.get('refreshInterval', 300) * 1000;
    refreshApi();
    apiTimer = setInterval(refreshApi, interval);
}
function abortInFlight() {
    if (abortController) {
        abortController.abort();
        abortController = undefined;
    }
}
async function refreshClaude() {
    try {
        const info = await contextReader.getContext();
        currentState.claude = { info, error: null };
        contextReader.checkThresholds(info);
    }
    catch (error) {
        currentState.claude = { info: null, error: error instanceof Error ? error.message : String(error) };
    }
    statusBar.update(currentState);
}
async function refreshApi() {
    abortInFlight();
    abortController = new AbortController();
    const signal = abortController.signal;
    statusBar.setLoading();
    const config = vscode.workspace.getConfiguration('codingPlan');
    const minimaxKey = config.get('minimaxKey');
    const glmKey = config.get('glmKey');
    try {
        const [minimaxRes, glmRes] = await Promise.allSettled([
            (0, minimaxFetcher_1.fetchMiniMax)(minimaxKey, signal),
            (0, glmFetcher_1.fetchGLM)(glmKey, signal),
        ]);
        if (signal.aborted)
            return;
        if (minimaxRes.status === 'fulfilled') {
            currentState.minimax = minimaxRes.value;
            currentState.apiErrors.minimax = false;
        }
        else {
            logError('MiniMax', minimaxRes.reason);
            currentState.apiErrors.minimax = true;
        }
        if (glmRes.status === 'fulfilled') {
            currentState.glm = glmRes.value;
            currentState.apiErrors.glm = false;
        }
        else {
            logError('GLM', glmRes.reason);
            currentState.apiErrors.glm = true;
        }
    }
    catch (e) {
        logError('API Update', e);
    }
    statusBar.update(currentState);
}
function logError(source, e) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.appendLine(`[ERROR] ${new Date().toLocaleTimeString()} [${source}] ${msg}`);
}
function deactivate() {
    if (claudeTimer)
        clearInterval(claudeTimer);
    if (apiTimer)
        clearInterval(apiTimer);
    abortInFlight();
}
//# sourceMappingURL=extension.js.map