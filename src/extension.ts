import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { McpBridgeServer } from './mcpServer.js';
import * as bridge from './browserBridge.js';
import { CdpManager } from './cdp/cdpManager.js';
import { ensureClaudeMcpEntry } from './install/claudeConfig.js';

let server: McpBridgeServer | undefined;
let output: vscode.OutputChannel | undefined;

// Dev-only: verifies the invokeTool fallback response shape hasn't changed.
// Only runs in Extension Development Host. At activation time there is usually no open
// page, so 'unverified' is the common outcome — the probe catches the real format change
// if VS Code updates its run_playwright_code response envelope.
function runParseProbe(s: McpBridgeServer, out: vscode.OutputChannel): void {
    bridge.runPlaywrightCode('', 'return "invokeTool-ok";').then(value => {
        if (value === 'invokeTool-ok') {
            s.parseContract.status = 'ok';
            out.appendLine('[startup] parse probe: ok — invokeTool fallback format unchanged');
        } else if (value !== undefined) {
            s.parseContract.status = 'diverged';
            s.parseContract.details = `Expected "invokeTool-ok", got: ${value.slice(0, 100)}`;
            out.appendLine(`[startup] parse probe: DIVERGED — ${s.parseContract.details}`);
            vscode.window.showErrorMessage(
                'Integrated Browser MCP: VS Code response format may have changed. ' +
                'The invokeTool fallback path may return errors. ' +
                'Please update the extension or report the issue.',
                'Open Issue'
            ).then(choice => {
                if (choice === 'Open Issue') {
                    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/Nagell/vscode-integrated-browser-mcp/issues'));
                }
            });
        }
        // value === undefined: no Result: line — no open page, stay 'unverified'
    }).catch(() => {
        out.appendLine('[startup] parse probe skipped (no browser page ready)');
    });
}

// Returns all candidate argv.json paths to try. Writes to all of them so the command
// works on native Linux, WSL (Windows-side file), and native Windows.
function collectArgvPaths(): string[] {
    const toWsl = (p: string) => p
        .replace(/^([A-Za-z]):[/\\]/, (_, d: string) => `/mnt/${d.toLowerCase()}/`)
        .replace(/\\/g, '/');
    const candidates: string[] = [];
    if (process.env.USERPROFILE) {
        candidates.push(path.join(toWsl(process.env.USERPROFILE), '.vscode', 'argv.json'));
    }
    if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
        candidates.push(path.join(toWsl(`${process.env.HOMEDRIVE}${process.env.HOMEPATH}`), '.vscode', 'argv.json'));
    }
    candidates.push(path.join(os.homedir(), '.vscode', 'argv.json'));
    return [...new Set(candidates)];
}

function parseArgvJson(raw: string): Record<string, unknown> {
    return JSON.parse(raw.replace(/\/\/[^\n]*/g, '')) as Record<string, unknown>;
}

async function doEnableCdp(argvPaths: string[], out: vscode.OutputChannel): Promise<boolean> {
    const extId = 'Nagell.vscode-integrated-browser-mcp';
    let wrote = 0;
    for (const argvPath of argvPaths) {
        let existing: Record<string, unknown> = {};
        try {
            existing = parseArgvJson(fs.readFileSync(argvPath, 'utf-8'));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                out.appendLine(`[enableCdp] skipping ${argvPath}: ${err}`);
                continue;
            }
        }
        const current = Array.isArray(existing['enable-proposed-api'])
            ? (existing['enable-proposed-api'] as string[])
            : [];
        if (current.includes(extId)) { wrote++; continue; }
        const merged = { ...existing, 'enable-proposed-api': [...current, extId] };
        const tmpPath = `${argvPath}.tmp-${process.pid}`;
        try {
            fs.mkdirSync(path.dirname(argvPath), { recursive: true });
            fs.writeFileSync(tmpPath, JSON.stringify(merged, null, '\t') + '\n', 'utf-8');
            fs.renameSync(tmpPath, argvPath);
            out.appendLine(`[enableCdp] wrote enable-proposed-api to ${argvPath}`);
            wrote++;
        } catch (err) {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            out.appendLine(`[enableCdp] could not write to ${argvPath}: ${err}`);
        }
    }
    return wrote > 0;
}

export async function activate(context: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('Integrated Browser MCP');
    server = new McpBridgeServer(output);
    bridge.setOutput(output);

    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    const cfg = vscode.workspace.getConfiguration('integratedBrowserMcp');
    // cfg.get('port') resolves the schema default (3100) even when not explicitly set,
    // so use inspect() to distinguish user-configured values from the schema default.
    const portInspect = cfg.inspect<number>('port');
    const userPort = portInspect?.globalValue ?? portInspect?.workspaceValue ?? portInspect?.workspaceFolderValue;
    const port: number = userPort ?? (isDev ? 3101 : 3100);
    const autoStart: boolean = cfg.get('autoStart') ?? true;
    const serverName = isDev ? 'integratedBrowser-dev' : 'integratedBrowser';

    // Wire CDP if VS Code proposed browser API is available
    const win = vscode.window as unknown as Record<string, unknown>;
    if (typeof win['browserTabs'] !== 'undefined') {
        const manager = new CdpManager(output);
        bridge.setCdpManager(manager);
        context.subscriptions.push({ dispose: () => manager.dispose() });
        const onOpen = win['onDidOpenBrowserTab'] as ((listener: () => void) => vscode.Disposable) | undefined;
        if (onOpen) {
            context.subscriptions.push(
                (onOpen as (...args: unknown[]) => vscode.Disposable).call(vscode.window, () => {
                    output?.appendLine('[cdp] browser tab opened externally');
                })
            );
        }
        output.appendLine('[cdp] proposed browser API detected — CDP mode active');
    } else {
        output.appendLine('[cdp] proposed browser API not available — using invokeTool fallback (consent dialogs will appear)');
    }

    if (autoStart) {
        try {
            await server.start(port);
            output.appendLine(`MCP server started on http://127.0.0.1:${port}/mcp`);
            if (isDev) { runParseProbe(server, output); }
            ensureClaudeMcpEntry(context, output, port, serverName).catch(err => {
                output?.appendLine(`[claudeConfig] unexpected error: ${err}`);
            });
        } catch (err) {
            output.appendLine(`Failed to start MCP server: ${err}`);
            if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
                vscode.window.showErrorMessage(`Integrated Browser MCP: port ${port} is already in use. Change the port in settings.`);
            } else {
                vscode.window.showErrorMessage(`Integrated Browser MCP: failed to auto-start — ${(err as Error).message ?? String(err)}`);
            }
        }
    }

    // Lazily-created shared channel for all diagnostic commands below.
    let debugOutput: vscode.OutputChannel | undefined;
    const getDebugChannel = () => {
        if (!debugOutput) {
            debugOutput = vscode.window.createOutputChannel('Browser MCP Debug');
            context.subscriptions.push(debugOutput);
        }
        return debugOutput;
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('integratedBrowserMcp.startServer', async () => {
            if (server?.port !== undefined) {
                vscode.window.showInformationMessage(`MCP server already running on port ${server.port}`);
                return;
            }
            try {
                await server!.start(port);
                vscode.window.showInformationMessage(`MCP server started on port ${server!.port}`);
            } catch (err) {
                const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
                    ? `Integrated Browser MCP: port ${port} is already in use. Change the port in settings.`
                    : `Failed to start MCP server: ${err}`;
                vscode.window.showErrorMessage(msg);
            }
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.stopServer', async () => {
            try {
                await server?.stop();
                vscode.window.showInformationMessage('MCP server stopped');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to stop MCP server: ${err}`);
            }
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.listTools', () => {
            const ch = getDebugChannel();
            ch.appendLine('=== Registered LM Tools ===');
            ch.appendLine(vscode.lm.tools.map(t => t.name).join('\n'));
            ch.show();
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.enableCdp', async () => {
            const argvPaths = collectArgvPaths();
            const extId = 'Nagell.vscode-integrated-browser-mcp';

            const alreadyEnabled = argvPaths.some(p => {
                try {
                    const parsed = parseArgvJson(fs.readFileSync(p, 'utf-8'));
                    return Array.isArray(parsed['enable-proposed-api']) &&
                        (parsed['enable-proposed-api'] as string[]).includes(extId);
                } catch { return false; }
            });
            if (alreadyEnabled) {
                void vscode.window.showInformationMessage('Integrated Browser MCP: CDP is already enabled. Restart VS Code if dialogs still appear.');
                return;
            }

            const choice = await vscode.window.showInformationMessage(
                'Enable dialog-free browser tools? This adds "enable-proposed-api" to your VS Code argv.json and requires a restart.',
                'Enable',
                'Cancel'
            );
            if (choice !== 'Enable') { return; }

            const success = await doEnableCdp(argvPaths, output!);
            if (success) {
                void vscode.window.showInformationMessage('Restart VS Code to enable dialog-free browser tools.');
            } else {
                void vscode.window.showErrorMessage('Integrated Browser MCP: could not write to any argv.json location.');
            }
        }),

        output,
    );

    // First-run prompt: offer CDP setup when the API is not yet active.
    // Skipped in dev/test mode (isDev) and after the user has already responded.
    if (!isDev && typeof win['browserTabs'] === 'undefined') {
        const prompted = context.globalState.get<boolean>('cdpSetupPromptShown', false);
        if (!prompted) {
            void context.globalState.update('cdpSetupPromptShown', true);
            void vscode.window.showInformationMessage(
                'Enable dialog-free browser tools? This modifies argv.json and requires a VS Code restart.',
                'Enable',
                'Not now'
            ).then(choice => {
                if (choice !== 'Enable') { return; }
                doEnableCdp(collectArgvPaths(), output!).then(success => {
                    if (success) {
                        void vscode.window.showInformationMessage('Restart VS Code to enable dialog-free browser tools.');
                    } else {
                        void vscode.window.showErrorMessage('Integrated Browser MCP: could not write to any argv.json location.');
                    }
                }).catch(() => { /* ignore */ });
            });
        }
    }
}

export async function deactivate() {
    try {
        await server?.stop();
    } catch (err) {
        output?.appendLine(`[deactivate] error stopping MCP server: ${err}`);
    }
}
