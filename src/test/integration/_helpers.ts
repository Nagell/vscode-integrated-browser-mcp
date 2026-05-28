import * as http from 'node:http';
import * as vscode from 'vscode';
import { McpBridgeServer } from '../../mcpServer.js';

export const INT_PORT = 3198;

interface ToolResult {
    content: { type: string; text?: string; data?: string; mimeType?: string }[];
    isError?: boolean;
}

// Minimal HTTP MCP client for integration tests.
export class McpTestClient {
    readonly server: McpBridgeServer;
    private readonly port: number;
    private sessionId: string | undefined;
    private output: vscode.OutputChannel | undefined;

    constructor(port = INT_PORT) {
        this.port = port;
        this.output = vscode.window.createOutputChannel('Int-Test MCP');
        this.server = new McpBridgeServer(this.output);
    }

    async start(): Promise<void> {
        await this.server.start(this.port);
        const res = await this._req({
            jsonrpc: '2.0', method: 'initialize',
            params: { protocolVersion: '2024-11-05', clientInfo: { name: 'int-test', version: '0.0.0' }, capabilities: {} },
            id: 1
        });
        this.sessionId = res.headers['mcp-session-id'] as string;
    }

    async stop(): Promise<void> {
        await this.server.stop();
        this.output?.dispose();
    }

    async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        const res = await this._req(
            { jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 2 },
            { 'mcp-session-id': this.sessionId! }
        );
        const line = res.body.split('\n').find(l => l.startsWith('data:'));
        if (!line) { throw new Error(`no data line in: ${res.body.slice(0, 200)}`); }
        const payload = JSON.parse(line.slice('data:'.length).trim()) as { result: ToolResult };
        return payload.result;
    }

    // Opens a browser page via MCP. Returns pageId or undefined if the browser is unavailable.
    async openPage(url: string): Promise<string | undefined> {
        try {
            const result = await this.call('open_browser_page', { url });
            if (result.isError) { return undefined; }
            const text = result.content.find(c => c.type === 'text')?.text ?? '';
            return text.match(/pageId:\s*(\S+)/)?.[1];
        } catch {
            return undefined;
        }
    }

    private _req(
        body: unknown,
        extraHeaders: Record<string, string> = {}
    ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1', port: this.port, path: '/mcp', method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Content-Length': Buffer.byteLength(payload),
                    ...extraHeaders
                }
            }, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }
}
