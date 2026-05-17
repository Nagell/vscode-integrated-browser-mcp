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
        }
    }

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

        // Debug commands from U1 experiment — kept for diagnostic use
        vscode.commands.registerCommand('integratedBrowserMcp.listTools', () => {
            const ch = vscode.window.createOutputChannel('Browser MCP Debug');
            ch.appendLine('=== Registered LM Tools ===');
            ch.appendLine(vscode.lm.tools.map(t => t.name).join('\n'));
            ch.show();
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.testInvoke', async () => {
            const cts = new vscode.CancellationTokenSource();
            const ch = vscode.window.createOutputChannel('Browser MCP Debug');
            try {
                ch.appendLine('=== invoking open_browser_page ===');
                const result = await vscode.lm.invokeTool('open_browser_page', {
                    input: { url: 'https://example.com' },
                    toolInvocationToken: undefined
                }, cts.token);
                ch.appendLine(JSON.stringify(result, null, 2));
            } catch (e) {
                ch.appendLine(`ERROR: ${e}`);
            } finally {
                cts.dispose();
                ch.show();
            }
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.probeSchemas', () => {
            const ch = vscode.window.createOutputChannel('Browser MCP Debug');
            const browserTools = vscode.lm.tools.filter(t =>
                ['open_browser_page', 'read_page', 'screenshot_page', 'navigate_page',
                 'click_element', 'type_in_page', 'hover_element', 'drag_element',
                 'handle_dialog', 'run_playwright_code'].includes(t.name)
            );
            ch.appendLine('=== Browser Tool Schemas ===');
            for (const tool of browserTools) {
                ch.appendLine(`\n--- ${tool.name} ---`);
                ch.appendLine(`description: ${tool.description}`);
                ch.appendLine(`inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
            }
            ch.show();
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.testPageTools', async () => {
            const cts = new vscode.CancellationTokenSource();
            const ch = vscode.window.createOutputChannel('Browser MCP Debug');
            try {
                ch.appendLine('=== 1. open_browser_page ===');
                const openResult = await vscode.lm.invokeTool('open_browser_page', {
                    input: { url: 'https://example.com' },
                    toolInvocationToken: undefined
                }, cts.token);

                const parts = (openResult as vscode.LanguageModelToolResult).content as unknown[];
                const firstText = parts.find(p => p instanceof vscode.LanguageModelTextPart) as vscode.LanguageModelTextPart | undefined;
                const pageId = firstText?.value.match(/Page ID:\s*(\S+)/)?.[1];
                ch.appendLine(`pageId: ${pageId}`);
                if (!pageId) { ch.appendLine('ERROR: could not extract pageId'); return; }

                ch.appendLine('\n=== 2. read_page ===');
                const readResult = await vscode.lm.invokeTool('read_page', { input: { pageId }, toolInvocationToken: undefined }, cts.token);
                ch.appendLine(JSON.stringify(readResult, null, 2));

                ch.appendLine('\n=== 3. screenshot_page ===');
                const shotResult = await vscode.lm.invokeTool('screenshot_page', { input: { pageId }, toolInvocationToken: undefined }, cts.token);
                const shotParts = (shotResult as vscode.LanguageModelToolResult).content as unknown[];
                for (const [i, part] of shotParts.entries()) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        ch.appendLine(`part[${i}] TextPart: ${part.value.slice(0, 200)}`);
                    } else if (part instanceof vscode.LanguageModelDataPart) {
                        ch.appendLine(`part[${i}] DataPart mimeType=${part.mimeType} bytes=${part.data.byteLength}`);
                    }
                }
            } catch (e) {
                ch.appendLine(`ERROR: ${e}`);
            } finally {
                cts.dispose();
                ch.show();
            }
        }),

        output
    );
}

export async function deactivate() {
    try {
        await server?.stop();
    } catch { /* ignore */ }
}
