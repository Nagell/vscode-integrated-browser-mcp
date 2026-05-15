import * as vscode from 'vscode';

// Entry point — implementation starts in Task 2 of the plan
export function activate(context: vscode.ExtensionContext) {
    const listTools = vscode.commands.registerCommand('integratedBrowserMcp.listTools', async () => {
        // Task 1 experiment: enumerate all registered LM tools to find browser tool IDs
        const tools = await vscode.lm.tools;
        const names = tools.map(t => t.name).join('\n');
        vscode.window.showInformationMessage('LM Tools found — check Output panel');
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        channel.appendLine('=== Registered LM Tools ===');
        channel.appendLine(names);
        channel.show();
    });

    context.subscriptions.push(listTools);
}

export function deactivate() {}
