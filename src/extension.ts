import * as vscode from 'vscode';
import { FileReader } from './claude/fileReader';
import { ContextReader } from './claude/contextReader';
import { HealthMonitor } from './claude/healthMonitor';
import { StatusBarManager } from './statusBarManager';
import { WebviewPanel } from './webviewPanel';
import { fetchMiniMax } from './api/minimaxFetcher';
import { fetchGLM } from './api/glmFetcher';
import { eventLogger } from './eventLogger';
import type { CombinedState, SessionHealth } from './shared/types';
import { EMPTY_MINIMAX, EMPTY_GLM } from './shared/types';

let statusBar: StatusBarManager;
let webviewPanel: WebviewPanel;
let contextReader: ContextReader;
let healthMonitor: HealthMonitor;
let outputChannel: vscode.OutputChannel;

let claudeTimer: NodeJS.Timeout | undefined;
let apiTimer: NodeJS.Timeout | undefined;
let abortController: AbortController | undefined;
let autoRefreshEnabled = true;

// Current combined state
let currentState: CombinedState = {
    claude: { info: null, error: null },
    health: 'no_session',
    healthReason: '',
    minimax: { ...EMPTY_MINIMAX },
    glm: { ...EMPTY_GLM },
    apiErrors: { minimax: false, glm: false },
    logs: [],
};

export function activate(context: vscode.ExtensionContext) {
    console.log('Coding Monitor is now active');

    outputChannel = vscode.window.createOutputChannel('Coding Monitor');
    context.subscriptions.push(outputChannel);

    const fileReader = new FileReader();
    contextReader = new ContextReader(fileReader);

    statusBar = new StatusBarManager();
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    webviewPanel = new WebviewPanel(() => {
        // After config saved in webview, immediately refresh API
        refreshApi();
        refreshClaude();
    });

    // Health monitor with callback
    healthMonitor = new HealthMonitor(
        outputChannel,
        () => contextReader.findActiveSessionFile(),
        (state: SessionHealth, reason: string) => {
            const prevHealth = currentState.health;
            currentState.health = state;
            currentState.healthReason = reason;

            // Log health state changes
            if (state !== prevHealth) {
                if (state === 'frozen') {
                    eventLogger.error('Health', `Session frozen: ${reason}`);
                } else if (state === 'api_error') {
                    eventLogger.error('Health', `API error: ${reason}`);
                } else if (state === 'healthy' && prevHealth !== 'no_session') {
                    eventLogger.success('Health', 'Session recovered');
                } else if (state === 'no_session' && prevHealth !== 'no_session') {
                    eventLogger.info('Health', 'Session ended');
                }
                currentState.logs = eventLogger.getLogs();
            }

            statusBar.update(currentState);
        }
    );
    healthMonitor.start();
    context.subscriptions.push({ dispose: () => healthMonitor.stop() });

    // Commands
    // Single click: refresh, Double click: show details
    let clickTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.commands.registerCommand('codingMonitor.statusBarClick', () => {
            if (clickTimer) {
                // Double click
                clearTimeout(clickTimer);
                clickTimer = undefined;
                webviewPanel.show(currentState);
            } else {
                // First click — wait to see if double click follows
                clickTimer = setTimeout(() => {
                    clickTimer = undefined;
                    refreshClaude();
                    refreshApi();
                }, 300);
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('codingMonitor.showDetails', () => {
            webviewPanel.show(currentState);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeContext.refresh', () => refreshClaude())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeContext.toggleAutoRefresh', () => {
            autoRefreshEnabled = !autoRefreshEnabled;
            const status = autoRefreshEnabled ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Claude Context auto-refresh ${status}`);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeContext.showFreezeLog', () => {
            outputChannel.show(true);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('codingPlan.refresh', () => refreshApi())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('codingMonitor.openSettings', () => {
            webviewPanel.show(currentState, 'settings');
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('codingMonitor.testLogs', () => {
            eventLogger.error('Test', 'This is a test error message');
            eventLogger.warning('Test', 'This is a test warning message');
            eventLogger.info('Test', 'This is a test info message');
            currentState.logs = eventLogger.getLogs();
            vscode.window.showInformationMessage('Test logs added! Check status bar.');
        })
    );

    // Config change listeners
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeContext.refreshInterval')) {
                startClaudeTimer();
            }
            if (e.affectsConfiguration('codingPlan')) {
                startApiTimer();
            }
            if (e.affectsConfiguration('codingMonitor.statusBarAlignment') ||
                e.affectsConfiguration('codingMonitor.statusBarPriority')) {
                statusBar.updatePosition();
            }
        })
    );

    // Initial refresh
    refreshClaude();
    refreshApi();

    // Start timers
    startClaudeTimer();
    startApiTimer();
}

function startClaudeTimer() {
    if (claudeTimer) clearInterval(claudeTimer);
    const config = vscode.workspace.getConfiguration('claudeContext');
    const interval = config.get<number>('refreshInterval', 5000);
    claudeTimer = setInterval(() => {
        if (autoRefreshEnabled) {
            refreshClaude();
        }
    }, interval);
}

function startApiTimer() {
    if (apiTimer) clearInterval(apiTimer);
    abortInFlight();

    const config = vscode.workspace.getConfiguration('codingPlan');
    const interval = config.get<number>('refreshInterval', 300) * 1000;

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

        // Log threshold warnings
        if (info) {
            const config = vscode.workspace.getConfiguration('claudeContext');
            const warningThreshold = config.get<number>('warningThreshold', 70);
            const criticalThreshold = config.get<number>('criticalThreshold', 90);

            if (info.percentage >= criticalThreshold) {
                eventLogger.error('Context', `Critical: ${info.percentage.toFixed(1)}% context used`);
                currentState.logs = eventLogger.getLogs();
            } else if (info.percentage >= warningThreshold) {
                eventLogger.warning('Context', `Warning: ${info.percentage.toFixed(1)}% context used`);
                currentState.logs = eventLogger.getLogs();
            }
        }
    } catch (error) {
        currentState.claude = { info: null, error: error instanceof Error ? error.message : String(error) };
        eventLogger.error('Context', `Failed to read context: ${error instanceof Error ? error.message : String(error)}`);
        currentState.logs = eventLogger.getLogs();
    }
    statusBar.update(currentState);
}

async function refreshApi() {
    abortInFlight();
    abortController = new AbortController();
    const signal = abortController.signal;

    statusBar.setLoading();

    const config = vscode.workspace.getConfiguration('codingPlan');
    const minimaxKey = config.get<string>('minimaxKey');
    const glmKey = config.get<string>('glmKey');

    try {
        const [minimaxRes, glmRes] = await Promise.allSettled([
            fetchMiniMax(minimaxKey, signal),
            fetchGLM(glmKey, signal),
        ]);

        if (signal.aborted) return;

        if (minimaxRes.status === 'fulfilled') {
            currentState.minimax = minimaxRes.value;
            currentState.apiErrors.minimax = false;

            // Log quota warnings
            if (minimaxRes.value.h5Percent >= 95) {
                eventLogger.error('MiniMax', `Quota critical: ${minimaxRes.value.h5Percent}% used`);
            } else if (minimaxRes.value.h5Percent >= 80) {
                eventLogger.warning('MiniMax', `Quota warning: ${minimaxRes.value.h5Percent}% used`);
            }
        } else {
            logError('MiniMax', minimaxRes.reason);
            currentState.apiErrors.minimax = true;
            eventLogger.error('MiniMax', `API error: ${minimaxRes.reason instanceof Error ? minimaxRes.reason.message : String(minimaxRes.reason)}`);
        }

        if (glmRes.status === 'fulfilled') {
            currentState.glm = glmRes.value;
            currentState.apiErrors.glm = false;

            // Log quota warnings
            if (glmRes.value.tokens5h >= 95) {
                eventLogger.error('GLM', `Quota critical: ${glmRes.value.tokens5h}% used`);
            } else if (glmRes.value.tokens5h >= 80) {
                eventLogger.warning('GLM', `Quota warning: ${glmRes.value.tokens5h}% used`);
            }
        } else {
            logError('GLM', glmRes.reason);
            currentState.apiErrors.glm = true;
            eventLogger.error('GLM', `API error: ${glmRes.reason instanceof Error ? glmRes.reason.message : String(glmRes.reason)}`);
        }

        currentState.logs = eventLogger.getLogs();
    } catch (e) {
        logError('API Update', e);
        eventLogger.error('API', `Update failed: ${e instanceof Error ? e.message : String(e)}`);
        currentState.logs = eventLogger.getLogs();
    }

    statusBar.update(currentState);
}

function logError(source: string, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.appendLine(`[ERROR] ${new Date().toLocaleTimeString()} [${source}] ${msg}`);
}

export function deactivate() {
    if (claudeTimer) clearInterval(claudeTimer);
    if (apiTimer) clearInterval(apiTimer);
    abortInFlight();
}
