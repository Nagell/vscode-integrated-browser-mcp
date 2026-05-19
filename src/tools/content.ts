import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent } from '../util/mcpResult.js';
import { pageIdSchema } from './_schemas.js';
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
}
