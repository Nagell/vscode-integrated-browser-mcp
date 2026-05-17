import * as assert from 'assert';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { McpBridgeServer } from '../mcpServer.js';

const TEST_PORT = 3199;

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }).on('error', reject);
    });
}

function post(url: string, body: unknown): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const options = new URL(url);
        const req = http.request({
            hostname: options.hostname,
            port: options.port,
            path: options.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

suite('McpBridgeServer', () => {
    let output: vscode.OutputChannel;
    let server: McpBridgeServer;

    setup(async () => {
        output = vscode.window.createOutputChannel('Test MCP Output');
        server = new McpBridgeServer(output);
        await server.start(TEST_PORT);
    });

    teardown(async () => {
        await server.stop();
        output.dispose();
    });

    test('GET /health returns 200 with status ok', async () => {
        const res = await get(`http://127.0.0.1:${TEST_PORT}/health`);
        assert.strictEqual(res.status, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.status, 'ok');
        assert.strictEqual(typeof body.sessions, 'number');
    });

    test('sessionCount is 0 before any client connects', () => {
        assert.strictEqual(server.sessionCount, 0);
    });

    test('port is set after start', () => {
        assert.strictEqual(server.port, TEST_PORT);
    });

    test('port is undefined after stop', async () => {
        await server.stop();
        assert.strictEqual(server.port, undefined);
        // Prevent teardown from trying to stop again — restart so teardown doesn't error
        await server.start(TEST_PORT);
    });

    test('POST /mcp without session ID and non-initialize body returns 400', async () => {
        const res = await post(`http://127.0.0.1:${TEST_PORT}/mcp`, {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'open_browser_page', arguments: {} },
            id: 1
        });
        assert.strictEqual(res.status, 400);
    });

    test('MCP initialize request creates a session and returns mcp-session-id', async () => {
        const res = await post(`http://127.0.0.1:${TEST_PORT}/mcp`, {
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                clientInfo: { name: 'test-client', version: '0.0.0' },
                capabilities: {}
            },
            id: 1
        });
        assert.ok(res.status === 200, `expected 200, got ${res.status}: ${res.body}`);
        assert.ok(res.headers['mcp-session-id'], 'expected mcp-session-id header');
        // Response is SSE — extract the data line and parse as JSON
        const dataLine = res.body.split('\n').find(l => l.startsWith('data:'));
        assert.ok(dataLine, `expected a data line in SSE response, got: ${res.body.slice(0, 200)}`);
        const payload = JSON.parse(dataLine.slice('data:'.length).trim());
        assert.ok(payload.result?.protocolVersion, 'expected protocolVersion in result');
    });

    test('GET /mcp without session ID returns 400', async () => {
        const res = await get(`http://127.0.0.1:${TEST_PORT}/mcp`);
        assert.strictEqual(res.status, 400);
    });

    suite('after MCP session initialised', () => {
        let sessionId: string;

        setup(async () => {
            const res = await post(`http://127.0.0.1:${TEST_PORT}/mcp`, {
                jsonrpc: '2.0', method: 'initialize',
                params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '0.0.0' }, capabilities: {} },
                id: 1
            });
            sessionId = res.headers['mcp-session-id'] as string;
        });

        function rpc(method: string, params: unknown, id: number) {
            return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
                (resolve, reject) => {
                    const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id });
                    const req = http.request({
                        hostname: '127.0.0.1', port: TEST_PORT, path: '/mcp', method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/event-stream',
                            'Content-Length': Buffer.byteLength(payload),
                            'mcp-session-id': sessionId
                        }
                    }, (res) => {
                        let data = '';
                        res.on('data', (c) => { data += c; });
                        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
                    });
                    req.on('error', reject);
                    req.write(payload);
                    req.end();
                }
            );
        }

        function parseResult(body: string): unknown {
            const line = body.split('\n').find(l => l.startsWith('data:'));
            assert.ok(line, `no data line in: ${body.slice(0, 200)}`);
            return JSON.parse(line.slice('data:'.length).trim());
        }

        test('tools/list returns all 8 expected tools', async () => {
            const res = await rpc('tools/list', {}, 2);
            assert.strictEqual(res.status, 200);
            const payload = parseResult(res.body) as { result: { tools: { name: string }[] } };
            const names = payload.result.tools.map(t => t.name);
            const expected = [
                'open_browser_page', 'list_pages', 'close_page',
                'read_page', 'screenshot_page', 'navigate_page',
                'click_element', 'type_in_page'
            ];
            for (const name of expected) {
                assert.ok(names.includes(name), `expected tool "${name}" in list, got: ${names.join(', ')}`);
            }
        });

        test('list_pages returns empty for a fresh session', async () => {
            const res = await rpc('tools/call', { name: 'list_pages', arguments: {} }, 2);
            assert.strictEqual(res.status, 200);
            const payload = parseResult(res.body) as { result: { content: { type: string; text: string }[] } };
            const text = payload.result.content.find(c => c.type === 'text')?.text ?? '';
            assert.ok(text.includes('no pages open'), `expected "(no pages open)", got: ${text}`);
        });

        test('close_page with unknown pageId returns success (not an error)', async () => {
            const res = await rpc('tools/call', { name: 'close_page', arguments: { pageId: 'nonexistent-page-id' } }, 2);
            assert.strictEqual(res.status, 200);
            const payload = parseResult(res.body) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
            assert.ok(!payload.result.isError, 'expected isError to be falsy for unknown pageId');
            const text = payload.result.content.find(c => c.type === 'text')?.text ?? '';
            assert.ok(text.includes('closed'), `expected "closed" in response, got: ${text}`);
        });
    });

    test('second McpBridgeServer on same port fails with EADDRINUSE', async () => {
        const server2 = new McpBridgeServer(output);
        try {
            await server2.start(TEST_PORT);
            assert.fail('expected EADDRINUSE error');
        } catch (err: unknown) {
            assert.ok((err as NodeJS.ErrnoException).code === 'EADDRINUSE');
        } finally {
            await server2.stop().catch(() => { /* already failed */ });
        }
    });
});
