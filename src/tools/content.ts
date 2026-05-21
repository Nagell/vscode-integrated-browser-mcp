import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent, parseContractGuard } from '../util/mcpResult.js';
import { pageIdSchema, selectorSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerContentTools(server: McpServer, ctx: ToolContext): void {
    const { output } = ctx;

    server.registerTool('read_page', {
        description: 'Read the current page content (accessibility tree) from the Integrated Browser.',
        inputSchema: { pageId: pageIdSchema }
    }, async ({ pageId }) => {
        output.appendLine(`[tool] read_page pageId=${pageId}`);
        try {
            return { content: await bridge.readPage(pageId) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] read_page: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('eval_js', {
        description: 'Runs arbitrary JavaScript in the open page — same trust model as the DevTools console. Don\'t pass untrusted input.',
        inputSchema: {
            pageId: pageIdSchema,
            expression: z.string().describe('JavaScript expression to evaluate in the page context')
        }
    }, async ({ pageId, expression }) => {
        output.appendLine(`[tool] eval_js pageId=${pageId}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            const result = await bridge.evalJs(pageId, expression);
            return { content: [{ type: 'text', text: result ?? 'undefined' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] eval_js: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('markdown', {
        description: 'Extract page content as clean markdown. ' +
            'Scopes to <main> by default, or <body> when no <main> is present. ' +
            'Pass a selector to scope to a specific element.',
        inputSchema: {
            pageId: pageIdSchema,
            selector: selectorSchema
        }
    }, async ({ pageId, selector }) => {
        output.appendLine(`[tool] markdown pageId=${pageId} selector=${selector}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            const result = await bridge.markdown(pageId, selector);
            return { content: [{ type: 'text', text: result ?? '' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] markdown: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('get_dom', {
        description: 'Get the outer HTML of the page or a specific element.',
        inputSchema: {
            pageId: pageIdSchema,
            selector: selectorSchema
        }
    }, async ({ pageId, selector }) => {
        output.appendLine(`[tool] get_dom pageId=${pageId} selector=${selector}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            const result = await bridge.getDom(pageId, selector);
            return { content: [{ type: 'text', text: result ?? '' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] get_dom: ${err}`);
            return errContent(err);
        }
    });
}
