import * as vscode from 'vscode';
import { McpBridgeServer } from './mcpServer.js';

let server: McpBridgeServer | undefined;
let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('Integrated Browser MCP');
    server = new McpBridgeServer(output);

    const cfg = vscode.workspace.getConfiguration('integratedBrowserMcp');
    const port: number = cfg.get('port') ?? 3100;
    const autoStart: boolean = cfg.get('autoStart') ?? true;

    if (autoStart) {
        try {
            await server.start(port);
            output.appendLine(`MCP server started on http://127.0.0.1:${port}/mcp`);
        } catch (err) {
            output.appendLine(`Failed to start MCP server: ${err}`);
            // EADDRINUSE already shows a specific message from the server error handler.
            if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
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
                vscode.window.showErrorMessage(`Failed to start MCP server: ${err}`);
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

        output
    );
}

export async function deactivate() {
    try {
        await server?.stop();
    } catch (err) {
        output?.appendLine(`[deactivate] error stopping MCP server: ${err}`);
    }
}
