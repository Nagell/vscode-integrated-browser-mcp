import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent, parseContractGuard } from '../util/mcpResult.js';
import { pageIdSchema, refSchema, selectorSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerVisualTools(server: McpServer, ctx: ToolContext): void {
    const { output } = ctx;

    server.registerTool('screenshot_page', {
        description: 'Take a screenshot of the current page in the Integrated Browser. ' +
            'Pass fullPage: true for a full-page capture (taller than the viewport). ' +
            'Pass waitMs to pause before capturing (useful for animations).',
        inputSchema: {
            pageId: pageIdSchema,
            ref: refSchema,
            selector: selectorSchema,
            fullPage: z.boolean().optional().describe('Capture the full scrollable page (default: false)'),
            waitMs: z.number().int().min(0).max(30000).optional().describe('Milliseconds to wait before capturing (max 30000)')
        }
    }, async ({ pageId, ref, selector, fullPage, waitMs }) => {
        output.appendLine(`[tool] screenshot_page pageId=${pageId} fullPage=${fullPage} waitMs=${waitMs}`);
        const guard = (fullPage || (waitMs !== undefined && waitMs > 0))
            ? parseContractGuard(ctx.parseContract.status, ctx.parseContract.details)
            : null;
        if (guard) { return guard; }
        try {
            return { content: await bridge.screenshotPage(pageId, ref, selector, fullPage, waitMs) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] screenshot_page: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('emulate', {
        description: 'Set the browser viewport size. Affects screenshot output and CSS layout (responsive breakpoints), not the visible panel size.',
        inputSchema: {
            pageId: pageIdSchema,
            width: z.number().int().positive().max(8192).describe('Viewport width in pixels'),
            height: z.number().int().positive().max(8192).describe('Viewport height in pixels')
        }
    }, async ({ pageId, width, height }) => {
        output.appendLine(`[tool] emulate pageId=${pageId} ${width}x${height}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        try {
            await bridge.emulate(pageId, width, height);
            return { content: [{ type: 'text', text: `Viewport set to ${width}x${height}.` }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] emulate: ${err}`);
            return errContent(err);
        }
    });
}
