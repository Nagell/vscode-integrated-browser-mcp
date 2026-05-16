import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const listTools = vscode.commands.registerCommand('integratedBrowserMcp.listTools', () => {
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        channel.appendLine('=== Registered LM Tools ===');
        channel.appendLine(vscode.lm.tools.map(t => t.name).join('\n'));
        channel.show();
    });

    const probeSchemas = vscode.commands.registerCommand('integratedBrowserMcp.probeSchemas', () => {
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        const browserTools = vscode.lm.tools.filter(t =>
            ['open_browser_page', 'read_page', 'screenshot_page', 'navigate_page',
             'click_element', 'type_in_page', 'hover_element', 'drag_element',
             'handle_dialog', 'run_playwright_code'].includes(t.name)
        );
        channel.appendLine('=== Browser Tool Schemas ===');
        for (const tool of browserTools) {
            channel.appendLine(`\n--- ${tool.name} ---`);
            channel.appendLine(`description: ${tool.description}`);
            channel.appendLine(`inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
        }
        channel.show();
    });

    const testInvoke = vscode.commands.registerCommand('integratedBrowserMcp.testInvoke', async () => {
        const cts = new vscode.CancellationTokenSource();
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        try {
            channel.appendLine('=== invoking open_browser_page ===');
            const result = await vscode.lm.invokeTool('open_browser_page', {
                input: { url: 'https://example.com' },
                toolInvocationToken: undefined
            }, cts.token);
            channel.appendLine(JSON.stringify(result, null, 2));
        } catch (e) {
            channel.appendLine(`ERROR: ${e}`);
        } finally {
            cts.dispose();
            channel.show();
        }
    });

    // Opens example.com, extracts pageId, then calls read_page and screenshot_page with it
    const testPageTools = vscode.commands.registerCommand('integratedBrowserMcp.testPageTools', async () => {
        const cts = new vscode.CancellationTokenSource();
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        try {
            channel.appendLine('=== 1. open_browser_page ===');
            const openResult = await vscode.lm.invokeTool('open_browser_page', {
                input: { url: 'https://example.com' },
                toolInvocationToken: undefined
            }, cts.token);

            const parts = (openResult as vscode.LanguageModelToolResult).content as unknown[];
            const firstText = parts.find(p => p instanceof vscode.LanguageModelTextPart) as vscode.LanguageModelTextPart | undefined;
            const pageId = firstText?.value.match(/Page ID:\s*(\S+)/)?.[1];
            channel.appendLine(`pageId: ${pageId}`);

            if (!pageId) {
                channel.appendLine('ERROR: could not extract pageId from open_browser_page result');
                return;
            }

            channel.appendLine('\n=== 2. read_page ===');
            const readResult = await vscode.lm.invokeTool('read_page', {
                input: { pageId },
                toolInvocationToken: undefined
            }, cts.token);
            channel.appendLine(JSON.stringify(readResult, null, 2));

            channel.appendLine('\n=== 3. screenshot_page ===');
            const shotResult = await vscode.lm.invokeTool('screenshot_page', {
                input: { pageId },
                toolInvocationToken: undefined
            }, cts.token);
            const shotParts = (shotResult as vscode.LanguageModelToolResult).content as unknown[];
            channel.appendLine(`parts count: ${shotParts.length}`);
            for (const [i, part] of shotParts.entries()) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    channel.appendLine(`part[${i}] TextPart: ${part.value.slice(0, 200)}`);
                } else if (part instanceof vscode.LanguageModelDataPart) {
                    channel.appendLine(`part[${i}] DataPart mimeType=${part.mimeType} bytes=${part.data.byteLength}`);
                } else {
                    channel.appendLine(`part[${i}] unknown: ${JSON.stringify(part).slice(0, 200)}`);
                }
            }
        } catch (e) {
            channel.appendLine(`ERROR: ${e}`);
        } finally {
            cts.dispose();
            channel.show();
        }
    });

    context.subscriptions.push(listTools, probeSchemas, testInvoke, testPageTools);
}

export function deactivate() {}
