import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent, parseContractGuard } from '../util/mcpResult.js';
import { pageIdSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerDiagnosticTools(server: McpServer, ctx: ToolContext): void {
    const { output } = ctx;

    server.registerTool('get_console', {
        description: 'Get buffered console messages from the page. ' +
            'Only captures output after open_browser_page is called (best-effort; may fail if the page blocks script injection via CSP). ' +
            'SPA navigations that reset window will clear the buffer — call get_console before navigating to preserve earlier output. ' +
            'Does not capture Service Workers, Web Workers, or cross-origin iframes.',
        inputSchema: {
            pageId: pageIdSchema,
            levels: z.array(z.enum(['log', 'warn', 'error', 'info', 'debug'])).optional()
                .describe('Filter by log level (omit for all levels)')
        }
    }, async ({ pageId, levels }) => {
        output.appendLine(`[tool] get_console pageId=${pageId} levels=${levels?.join(',') ?? 'all'}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            const result = await bridge.getConsole(pageId, levels);
            return { content: [{ type: 'text', text: result ?? '[]' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] get_console: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('clear_console', {
        description: 'Clear the buffered console messages for the page.',
        inputSchema: { pageId: pageIdSchema }
    }, async ({ pageId }) => {
        output.appendLine(`[tool] clear_console pageId=${pageId}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            await bridge.clearConsole(pageId);
            return { content: [{ type: 'text', text: 'Console cleared.' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] clear_console: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });
}
