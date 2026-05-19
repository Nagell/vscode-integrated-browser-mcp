import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent } from '../util/mcpResult.js';
import { pageIdSchema, refSchema, selectorSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerVisualTools(server: McpServer, ctx: ToolContext): void {
    const { output } = ctx;

    server.registerTool('screenshot_page', {
        description: 'Take a screenshot of the current page in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            ref: refSchema,
            selector: selectorSchema
        }
    }, async ({ pageId, ref, selector }) => {
        output.appendLine(`[tool] screenshot_page pageId=${pageId}`);
        try {
            return { content: await bridge.screenshotPage(pageId, ref, selector) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] screenshot_page: ${err}`);
            return errContent(err);
        }
    });
}
