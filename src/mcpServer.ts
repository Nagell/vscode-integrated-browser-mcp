import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import { z } from 'zod';
import * as bridge from './browserBridge.js';

interface PageInfo { url?: string; openedAt: Date }
type SessionEntry = { transport: StreamableHTTPServerTransport; server: McpServer; pages: Map<string, PageInfo> };

type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

function errContent(err: unknown): { content: McpContent[]; isError: true } {
    return { content: [{ type: 'text', text: `Error: ${err}` }], isError: true };
}

function createMcpServerInstance(output: vscode.OutputChannel, pages: Map<string, PageInfo>): McpServer {
    const server = new McpServer({ name: 'integrated-browser-mcp', version: '0.0.1' });

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
        inputSchema: { pageId: z.string().describe('Page ID from open_browser_page') }
    }, async ({ pageId }) => {
        output.appendLine(`[tool] close_page pageId=${pageId}`);
        await bridge.closePage(pageId).catch(err => output.appendLine(`[close_page] VS Code error (still removing): ${err}`));
        pages.delete(pageId);
        return { content: [{ type: 'text', text: `Page ${pageId} closed.` }] as McpContent[] };
    });

    server.registerTool('read_page', {
        description: 'Read the current page content (accessibility tree) from the Integrated Browser.',
        inputSchema: { pageId: z.string().describe('Page ID from open_browser_page') }
    }, async ({ pageId }) => {
        output.appendLine(`[tool] read_page pageId=${pageId}`);
        try {
            return { content: await bridge.readPage(pageId) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] read_page: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('screenshot_page', {
        description: 'Take a screenshot of the current page in the Integrated Browser.',
        inputSchema: {
            pageId: z.string().describe('Page ID from open_browser_page'),
            ref: z.string().optional().describe('Element ref from snapshot (e.g. "e6")'),
            selector: z.string().optional().describe('Playwright selector')
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

    server.registerTool('navigate_page', {
        description: 'Navigate the Integrated Browser: go to a URL, or go back/forward/reload.',
        inputSchema: {
            pageId: z.string().describe('Page ID from open_browser_page'),
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
            }
            return { content };
        } catch (err) {
            output.appendLine(`[error] navigate_page: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('click_element', {
        description: 'Click an element in the Integrated Browser.',
        inputSchema: {
            pageId: z.string().describe('Page ID from open_browser_page'),
            element: z.string().describe('Human-readable element description (e.g. "submit button")'),
            ref: z.string().optional().describe('Element ref from snapshot (e.g. "e6")'),
            selector: z.string().optional().describe('Playwright selector')
        }
    }, async ({ pageId, element, ref, selector }) => {
        output.appendLine(`[tool] click_element pageId=${pageId} element="${element}"`);
        try {
            return { content: await bridge.clickElement(pageId, element, ref, selector) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] click_element: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('type_in_page', {
        description: 'Type text or press a key in the Integrated Browser.',
        inputSchema: {
            pageId: z.string().describe('Page ID from open_browser_page'),
            text: z.string().optional().describe('Text to type'),
            key: z.string().optional().describe('Key to press (e.g. "Enter", "Control+c")'),
            ref: z.string().optional().describe('Element ref from snapshot'),
            selector: z.string().optional().describe('Playwright selector'),
            element: z.string().optional().describe('Human-readable element description')
        }
    }, async ({ pageId, text, key, ref, selector, element }) => {
        output.appendLine(`[tool] type_in_page pageId=${pageId} text=${text} key=${key}`);
        try {
            return { content: await bridge.typeInPage(pageId, text, key, ref, selector, element) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] type_in_page: ${err}`);
            return errContent(err);
        }
    });

    return server;
}

export class McpBridgeServer {
    private _httpServer: http.Server | undefined;
    private _sessions = new Map<string, SessionEntry>();
    private _output: vscode.OutputChannel;

    constructor(output: vscode.OutputChannel) {
        this._output = output;
    }

    get sessionCount(): number {
        return this._sessions.size;
    }

    get port(): number | undefined {
        if (!this._httpServer?.listening) { return undefined; }
        return (this._httpServer.address() as AddressInfo | null)?.port;
    }

    start(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const app = createMcpExpressApp();

            app.get('/health', (_req, res) => {
                res.json({ status: 'ok', sessions: this._sessions.size });
            });

            app.post('/mcp', async (req, res) => {
                try {
                    const sessionId = req.headers['mcp-session-id'] as string | undefined;
                    const existing = sessionId ? this._sessions.get(sessionId) : undefined;

                    if (existing) {
                        await existing.transport.handleRequest(req, res, req.body);
                        return;
                    }

                    if (!isInitializeRequest(req.body)) {
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
                            id: null
                        });
                        return;
                    }

                    const pages = new Map<string, PageInfo>();
                    const transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid) => {
                            this._output.appendLine(`[session] opened ${sid}`);
                            this._sessions.set(sid, { transport, server: mcpServer, pages });
                        },
                        onsessionclosed: (sid) => {
                            this._output.appendLine(`[session] closed ${sid}`);
                            this._sessions.delete(sid);
                        }
                    });

                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid) { this._sessions.delete(sid); }
                    };

                    const mcpServer = createMcpServerInstance(this._output, pages);
                    await mcpServer.connect(transport);
                    await transport.handleRequest(req, res, req.body);
                } catch (err) {
                    this._output.appendLine(`[error] POST /mcp: ${err}`);
                    if (!res.headersSent) {
                        res.status(500).json({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal server error' },
                            id: null
                        });
                    }
                }
            });

            app.get('/mcp', async (req, res) => {
                const sessionId = req.headers['mcp-session-id'] as string | undefined;
                const entry = sessionId ? this._sessions.get(sessionId) : undefined;
                if (!entry) {
                    res.status(400).send('Invalid or missing session ID');
                    return;
                }
                await entry.transport.handleRequest(req, res);
            });

            app.delete('/mcp', async (req, res) => {
                const sessionId = req.headers['mcp-session-id'] as string | undefined;
                const entry = sessionId ? this._sessions.get(sessionId) : undefined;
                if (!entry) {
                    res.status(400).send('Invalid or missing session ID');
                    return;
                }
                try {
                    await entry.transport.handleRequest(req, res);
                } catch (err) {
                    this._output.appendLine(`[error] DELETE /mcp: ${err}`);
                    if (!res.headersSent) { res.status(500).send('Error closing session'); }
                }
            });

            const server = http.createServer(app);
            this._httpServer = server;

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    const msg = `Integrated Browser MCP: port ${port} is already in use. Change the port in settings.`;
                    vscode.window.showErrorMessage(msg);
                    reject(err);
                } else {
                    reject(err);
                }
            });

            server.listen(port, '127.0.0.1', () => {
                this._output.appendLine(`[server] listening on port ${this.port}`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        for (const [sid, { transport }] of this._sessions) {
            try { await transport.close(); } catch { /* ignore */ }
            this._sessions.delete(sid);
        }

        return new Promise((resolve, reject) => {
            if (!this._httpServer) { resolve(); return; }
            this._httpServer.close((err) => {
                this._httpServer = undefined;
                if (err) { reject(err); } else { resolve(); }
            });
        });
    }
}
