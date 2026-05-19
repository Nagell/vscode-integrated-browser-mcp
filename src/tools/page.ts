import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent } from '../util/mcpResult.js';
import { pageIdSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerPageTools(server: McpServer, ctx: ToolContext): void {
    const { output, pages } = ctx;

    server.registerTool('open_browser_page', {
        description: 'Open a URL in VS Code\'s Integrated Browser and return a pageId required by all other tools. ' +
            'Always provide a url — even if the user already has the page open, pass its URL and VS Code will navigate to it. ' +
            'Pass forceNew: true to open a second tab alongside an existing one.',
        inputSchema: {
            url: z.string().optional().describe('URL to open (required in practice — always pass the URL)'),
            forceNew: z.boolean().optional().describe('Open in a new tab even if one is already open')
        }
    }, async ({ url, forceNew }) => {
        output.appendLine(`[tool] open_browser_page url=${url ?? '(none)'} forceNew=${forceNew ?? false}`);
        try {
            const { pageId, content } = await bridge.openBrowserPage(url, forceNew);
            pages.set(pageId, { url, openedAt: new Date() });
            return { content: [{ type: 'text', text: `pageId: ${pageId}` }, ...content] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] open_browser_page: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('list_pages', {
        description: 'List all browser pages open in this session.',
        inputSchema: {}
    }, async () => {
        output.appendLine('[tool] list_pages');
        const entries = Array.from(pages.entries()).map(
            ([id, info]) => `${id}  ${info.url ?? '(unknown url)'}`
        );
        const text = entries.length > 0 ? entries.join('\n') : '(no pages open)';
        return { content: [{ type: 'text', text }] as McpContent[] };
    });

    server.registerTool('close_page', {
        description: 'Close a browser page and remove it from the session.',
        inputSchema: { pageId: pageIdSchema }
    }, async ({ pageId }) => {
        output.appendLine(`[tool] close_page pageId=${pageId}`);
        let closeNote = '';
        try {
            await bridge.closePage(pageId);
        } catch (err) {
            output.appendLine(`[close_page] VS Code error closing tab: ${err}`);
            closeNote = ' (browser tab may still be visible)';
        }
        pages.delete(pageId);
        return { content: [{ type: 'text', text: `Page ${pageId} removed from session.${closeNote}` }] as McpContent[] };
    });

    server.registerTool('navigate_page', {
        description: 'Navigate the Integrated Browser: go to a URL, or go back/forward/reload.',
        inputSchema: {
            pageId: pageIdSchema,
            type: z.enum(['url', 'back', 'forward', 'reload']).optional().describe('Navigation type'),
            url: z.string().optional().describe('URL when type is "url"')
        }
    }, async ({ pageId, type, url }) => {
        output.appendLine(`[tool] navigate_page pageId=${pageId} type=${type} url=${url}`);
        try {
            const content = await bridge.navigatePage(pageId, type, url) as McpContent[];
            const text = (content.find(c => c.type === 'text') as { type: 'text'; text: string } | undefined)?.text;
            const newUrl = text?.match(/\nURL:\s*(\S+)/)?.[1];
            if (newUrl) {
                const info = pages.get(pageId);
                if (info) { pages.set(pageId, { ...info, url: newUrl }); }
            } else {
                output.appendLine(`[navigate_page] could not extract URL from response for pageId=${pageId}`);
            }
            return { content };
        } catch (err) {
            output.appendLine(`[error] navigate_page: ${err}`);
            return errContent(err);
        }
    });
}
