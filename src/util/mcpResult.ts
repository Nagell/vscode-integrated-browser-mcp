export type { McpContent } from '../browserBridge.js';

export function errContent(err: unknown): { content: [{ type: 'text'; text: string }]; isError: true } {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

export function parseContractGuard(
    status: string, details?: string
): { content: [{ type: 'text'; text: string }]; isError: true } | null {
    if (status !== 'diverged') { return null; }
    return {
        content: [{ type: 'text', text:
            'The Integrated Browser MCP extension cannot parse VS Code\'s run_playwright_code response. ' +
            'This usually means a VS Code update changed the response format. ' +
            'Update the extension or report at https://github.com/Nagell/vscode-integrated-browser-mcp/issues. ' +
            `Diagnostic: ${details ?? '(none)'}` }],
        isError: true
    };
}
