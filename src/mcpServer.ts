import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import type { PageInfo } from './tools/_context.js';
import { registerPageTools } from './tools/page.js';
import { registerInteractionTools } from './tools/interaction.js';
import { registerVisualTools } from './tools/visual.js';
import { registerContentTools } from './tools/content.js';
import { registerDiagnosticTools } from './tools/diagnostic.js';

interface SessionEntry { transport: StreamableHTTPServerTransport; server: McpServer; pages: Map<string, PageInfo> }

function getSessionId(req: http.IncomingMessage): string | undefined {
    const raw = req.headers['mcp-session-id'];
    return Array.isArray(raw) ? raw[0] : raw;
}

function createMcpServerInstance(output: vscode.OutputChannel, pages: Map<string, PageInfo>): McpServer {
    const server = new McpServer({ name: 'integrated-browser-mcp', version: '0.0.1' });
    const ctx = { output, pages };

    registerPageTools(server, ctx);
    registerInteractionTools(server, ctx);
    registerVisualTools(server, ctx);
    registerContentTools(server, ctx);
    registerDiagnosticTools(server, ctx);

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
                    const sessionId = getSessionId(req);
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
                    const mcpServer = createMcpServerInstance(this._output, pages);
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

                    // onsessionclosed handles clean MCP-level teardown; onclose is a fallback for abrupt transport drops.
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid) { this._sessions.delete(sid); }
                    };

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
                const sessionId = getSessionId(req);
                const entry = sessionId ? this._sessions.get(sessionId) : undefined;
                if (!entry) {
                    res.status(400).send('Invalid or missing session ID');
                    return;
                }
                try {
                    await entry.transport.handleRequest(req, res);
                } catch (err) {
                    this._output.appendLine(`[error] GET /mcp: ${err}`);
                    if (!res.headersSent) { res.status(500).send('Internal server error'); }
                }
            });

            app.delete('/mcp', async (req, res) => {
                const sessionId = getSessionId(req);
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
                    vscode.window.showErrorMessage(`Integrated Browser MCP: port ${port} is already in use. Change the port in settings.`);
                } else {
                    vscode.window.showErrorMessage(`Integrated Browser MCP: failed to start (${err.code ?? err.message}).`);
                }
                reject(err);
            });

            server.listen(port, '127.0.0.1', () => {
                this._output.appendLine(`[server] listening on port ${this.port}`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        for (const [sid, { transport }] of this._sessions) {
            try { await transport.close(); } catch (err) { this._output.appendLine(`[stop] failed to close session ${sid}: ${err}`); }
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
