import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent } from '../util/mcpResult.js';
import { pageIdSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';
import type { VisibleBrowserTab } from '../browserBridge.js';

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

    server.registerTool('list_visible_pages', {
        description: 'List all Simple Browser tabs currently open in VS Code, including ones not opened by this session. ' +
            'Useful before calling attach_visible_page to confirm which tabs are available.',
        inputSchema: {}
    }, () => {
        output.appendLine('[tool] list_visible_pages');
        const tabs: VisibleBrowserTab[] = bridge.enumerateVisibleBrowserTabs();
        if (tabs.length === 0) {
            return { content: [{ type: 'text', text: '(no browser tabs visible)' }] as McpContent[] };
        }
        const lines = tabs.map(t => {
            const active = t.isActive ? ' (active)' : '';
            const col = t.viewColumn !== undefined ? ` [col ${t.viewColumn}]` : '';
            return `${t.label}${active}${col}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] as McpContent[] };
    });

    server.registerTool('get_url', {
        description: 'Get the URL of an open browser page. Returns the URL at the time the page was opened or last navigated; may be stale after in-page navigation.',
        inputSchema: { pageId: pageIdSchema }
    }, ({ pageId }) => {
        output.appendLine(`[tool] get_url pageId=${pageId}`);
        const info = pages.get(pageId);
        const url = info?.url ?? '(unknown url)';
        return { content: [{ type: 'text', text: url }] as McpContent[] };
    });

    server.registerTool('attach_visible_page', {
        description: 'Attach to a browser tab already open in VS Code — including tabs opened externally via terminal links ' +
            'or Simple Browser — so you can use click, screenshot and other tools on it. ' +
            'Pass the tab\'s URL; if the tab is already open VS Code reuses it without opening a duplicate.',
        inputSchema: {
            url: z.string().describe('URL of the tab to attach to (check list_visible_pages for open tabs)')
        }
    }, async ({ url }) => {
        output.appendLine(`[tool] attach_visible_page url=${url}`);
        try {
            const { pageId, content } = await bridge.openBrowserPage(url, false);
            pages.set(pageId, { url, openedAt: new Date() });
            return { content: [{ type: 'text', text: `pageId: ${pageId}` }, ...content] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] attach_visible_page: ${err}`);
            return errContent(err);
        }
    });
}
