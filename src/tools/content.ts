import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent, parseContractGuard } from '../util/mcpResult.js';
import { pageIdSchema, selectorSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';
import { getCaptured, setCaptured } from '../elementCapture.js';

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
            return errContent(err, msg => ctx.output.appendLine(msg));
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
            return errContent(err, msg => ctx.output.appendLine(msg));
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
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('get_element_selection', {
        description: 'Return the element most recently selected via VS Code\'s built-in ' +
            '"Add Element to Chat" button (Ctrl+Shift+C) in the Integrated Browser toolbar. ' +
            'Returns the element\'s tag, text, HTML, and bounding rect. ' +
            'Returns an informational message when no element has been selected yet.',
        inputSchema: {}
    }, () => {
        output.appendLine('[tool] get_element_selection');
        const el = getCaptured();
        if (!el) {
            return { content: [{ type: 'text', text: 'No element selected. ' +
                'Use the "Add Element to Chat" button (Ctrl+Shift+C) in the ' +
                'Integrated Browser toolbar to pick an element, then call this tool.' }] as McpContent[] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(el, null, 2) }] as McpContent[] };
    });

    server.registerTool('clear_element_selection', {
        description: 'Clear the element captured by the last "Capture Element" command.',
        inputSchema: {}
    }, () => {
        output.appendLine('[tool] clear_element_selection');
        setCaptured(null);
        return { content: [{ type: 'text', text: 'Element selection cleared.' }] as McpContent[] };
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
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });
}
