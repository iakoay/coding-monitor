import * as vscode from 'vscode';
import { FileReader } from './claude/fileReader';
import { ContextReader } from './claude/contextReader';
import { HealthMonitor } from './claude/healthMonitor';
import { StatusBarManager } from './statusBarManager';
import { WebviewPanel } from './webviewPanel';
import { fetchMiniMax } from './api/minimaxFetcher';
import { fetchGLM } from './api/glmFetcher';
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
            currentState.health = state;
            currentState.healthReason = reason;
            statusBar.update(currentState);
        }
    );
    healthMonitor.start();
    context.subscriptions.push({ dispose: () => healthMonitor.stop() });

    // Commands
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

    // Config change listeners
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeContext.refreshInterval')) {
                startClaudeTimer();
            }
            if (e.affectsConfiguration('codingPlan')) {
                startApiTimer();
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
    } catch (error) {
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
        } else {
            logError('MiniMax', minimaxRes.reason);
            currentState.apiErrors.minimax = true;
        }

        if (glmRes.status === 'fulfilled') {
            currentState.glm = glmRes.value;
            currentState.apiErrors.glm = false;
        } else {
            logError('GLM', glmRes.reason);
            currentState.apiErrors.glm = true;
        }
    } catch (e) {
        logError('API Update', e);
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
