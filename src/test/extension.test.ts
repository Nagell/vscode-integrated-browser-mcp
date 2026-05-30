import * as assert from 'assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { McpBridgeServer } from '../mcpServer.js';
import { errContent } from '../util/mcpResult.js';
import { extractRpcResult, decodeBuffer, normalizeSlice } from '../browserBridge.js';
import { mergeEntry, alreadyRegistered } from '../install/claudeConfig.js';

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

function post(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
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
                'Content-Length': Buffer.byteLength(payload),
                ...extraHeaders
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

function del(url: string, sessionId?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const options = new URL(url);
        const headers: Record<string, string> = {};
        if (sessionId) { headers['mcp-session-id'] = sessionId; }
        const req = http.request({
            hostname: options.hostname,
            port: options.port,
            path: options.pathname,
            method: 'DELETE',
            headers
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        });
        req.on('error', reject);
        req.end();
    });
}

function textResult(...texts: string[]): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult(texts.map(t => new vscode.LanguageModelTextPart(t)));
}

suite('extractRpcResult', () => {
    test('extracts Result: value from a single text part', () => {
        const result = extractRpcResult(textResult('Result: foo\nPage Title: x'));
        assert.strictEqual(result, 'foo');
    });

    test('unwraps one level of JSON string quoting', () => {
        const result = extractRpcResult(textResult('Result: "{\\"a\\":1}"'));
        assert.strictEqual(result, '{"a":1}');
    });

    test('returns undefined for empty parts array', () => {
        assert.strictEqual(extractRpcResult(new vscode.LanguageModelToolResult([])), undefined);
    });

    test('returns undefined when no Result: prefix', () => {
        assert.strictEqual(extractRpcResult(textResult('Page Title: x\nSome content')), undefined);
    });
});

suite('decodeBuffer', () => {
    test('decodes {"type":"Buffer","data":[...]} shape', () => {
        const buf = decodeBuffer('{"type":"Buffer","data":[255,216,1,2]}');
        assert.deepStrictEqual(Array.from(buf), [255, 216, 1, 2]);
    });

    test('decodes bare number array', () => {
        const buf = decodeBuffer('[255,216,1,2]');
        assert.deepStrictEqual(Array.from(buf), [255, 216, 1, 2]);
    });

    test('throws on invalid JSON with Buffer in message', () => {
        assert.throws(() => decodeBuffer('not json'), /Buffer/);
    });
});

suite('normalizeSlice', () => {
    test('slice 0 of 5 returns 0', () => assert.strictEqual(normalizeSlice(0, 5), 0));
    test('slice 4 of 5 returns 4', () => assert.strictEqual(normalizeSlice(4, 5), 4));
    test('slice -1 of 5 returns 4 (last)', () => assert.strictEqual(normalizeSlice(-1, 5), 4));
    test('slice -5 of 5 returns 0', () => assert.strictEqual(normalizeSlice(-5, 5), 0));
    test('positive overshoot clamps to last (7 of 5 → 4)', () => assert.strictEqual(normalizeSlice(7, 5), 4));
    test('totalSlices 1: any index returns 0', () => {
        assert.strictEqual(normalizeSlice(0, 1), 0);
        assert.strictEqual(normalizeSlice(5, 1), 0);
        assert.strictEqual(normalizeSlice(-1, 1), 0);
    });
});

suite('errContent', () => {
    test('wraps an Error instance with isError: true', () => {
        const result = errContent(new Error('boom'));
        assert.strictEqual(result.isError, true);
        assert.strictEqual(result.content[0].type, 'text');
        assert.strictEqual(result.content[0].text, 'Error: boom');
    });

    test('wraps a string with isError: true', () => {
        const result = errContent('string error');
        assert.strictEqual(result.isError, true);
        assert.strictEqual(result.content[0].text, 'Error: string error');
    });
});

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

    test('POST /mcp with stale session ID and non-initialize body returns 400', async () => {
        const res = await post(`http://127.0.0.1:${TEST_PORT}/mcp`, {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'list_pages', arguments: {} },
            id: 1
        }, { 'mcp-session-id': '00000000-0000-0000-0000-000000000000' });
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

    test('DELETE /mcp without session ID returns 400', async () => {
        const res = await del(`http://127.0.0.1:${TEST_PORT}/mcp`);
        assert.strictEqual(res.status, 400);
    });

    test('stop() with active session resets sessionCount to 0', async () => {
        const res = await post(`http://127.0.0.1:${TEST_PORT}/mcp`, {
            jsonrpc: '2.0', method: 'initialize',
            params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '0.0.0' }, capabilities: {} },
            id: 1
        });
        assert.ok(res.headers['mcp-session-id'], 'session should be created');
        assert.strictEqual(server.sessionCount, 1);

        await server.stop();
        assert.strictEqual(server.sessionCount, 0);

        // Restart so teardown doesn't error
        await server.start(TEST_PORT);
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

        test('sessionCount is 1 after session initialized', () => {
            assert.strictEqual(server.sessionCount, 1);
        });

        test('/health shows sessions: 1 after session initialized', async () => {
            const res = await get(`http://127.0.0.1:${TEST_PORT}/health`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.sessions, 1);
        });

        test('DELETE /mcp with valid session ID returns 2xx', async () => {
            const res = await del(`http://127.0.0.1:${TEST_PORT}/mcp`, sessionId);
            assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}: ${res.body}`);
        });

        test('tools/list returns all 22 expected tools', async () => {
            const res = await rpc('tools/list', {}, 2);
            assert.strictEqual(res.status, 200);
            const payload = parseResult(res.body) as { result: { tools: { name: string }[] } };
            const names = payload.result.tools.map(t => t.name);
            const expected = [
                'open_browser_page', 'list_pages', 'close_page', 'navigate_page',
                'list_visible_pages', 'attach_visible_page', 'get_url',
                'screenshot_page', 'screenshot_slice', 'emulate',
                'read_page', 'markdown', 'eval_js', 'get_dom',
                'click_element', 'type_in_page', 'hover_element', 'drag_element', 'handle_dialog', 'scroll',
                'get_console', 'clear_console'
            ];
            assert.strictEqual(names.length, 22, `expected 22 tools, got: ${names.join(', ')}`);
            for (const name of expected) {
                assert.ok(names.includes(name), `expected tool "${name}" in list, got: ${names.join(', ')}`);
            }
        });

        test('screenshot_page schema includes fullPage and waitMs fields', async () => {
            const res = await rpc('tools/list', {}, 2);
            const payload = parseResult(res.body) as { result: { tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[] } };
            const tool = payload.result.tools.find(t => t.name === 'screenshot_page');
            assert.ok(tool, 'screenshot_page not found');
            const props = tool.inputSchema.properties ?? {};
            assert.ok('fullPage' in props, 'fullPage field missing from screenshot_page schema');
            assert.ok('waitMs' in props, 'waitMs field missing from screenshot_page schema');
        });

        test('screenshot_page without fullPage/waitMs succeeds (no parseContract error path)', async () => {
            const res = await rpc('tools/call', { name: 'screenshot_page', arguments: { pageId: 'x', fullPage: false } }, 2);
            assert.strictEqual(res.status, 200);
            const payload = parseResult(res.body) as { result: { isError?: boolean } };
            // With no real browser, will error — but must NOT be a parseContract diverged error
            if (payload.result.isError) {
                const text = (payload.result as unknown as { content: { text: string }[] }).content?.[0]?.text ?? '';
                assert.ok(!text.includes('cannot parse VS Code'), `unexpected parseContract error: ${text}`);
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
            assert.ok(text.includes('removed from session'), `expected "removed from session" in response, got: ${text}`);
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

// Compiled to out/test/ — go up two levels to reach src/test/fixtures/
const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'test', 'fixtures', 'claude.json.realistic');

suite('mergeEntry', () => {
    test('adds integratedBrowser to empty config', () => {
        const merged = mergeEntry({}, 'http://127.0.0.1:1234/mcp');
        assert.deepStrictEqual(merged.mcpServers, {
            integratedBrowser: { type: 'http', url: 'http://127.0.0.1:1234/mcp' }
        });
    });

    test('preserves all other top-level keys', () => {
        const existing = { theme: 'dark', telemetry: { enabled: false }, mcpServers: { other: { type: 'stdio' } } };
        const merged = mergeEntry(existing, 'http://127.0.0.1:1234/mcp');
        assert.strictEqual(merged.theme, 'dark');
        assert.deepStrictEqual(merged.telemetry, { enabled: false });
        assert.ok('other' in (merged.mcpServers as object), 'existing server preserved');
        assert.ok('integratedBrowser' in (merged.mcpServers as object), 'new entry added');
    });

    test('overwrites existing integratedBrowser entry', () => {
        const existing = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:9999/mcp' } } };
        const merged = mergeEntry(existing, 'http://127.0.0.1:1234/mcp');
        assert.deepStrictEqual(
            (merged.mcpServers as Record<string, unknown>).integratedBrowser,
            { type: 'http', url: 'http://127.0.0.1:1234/mcp' }
        );
    });

    test('realistic fixture: integratedBrowser added, all other keys preserved', () => {
        const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
        const merged = mergeEntry(fixture, 'http://127.0.0.1:1234/mcp');
        assert.deepStrictEqual(
            (merged.mcpServers as Record<string, unknown>).integratedBrowser,
            { type: 'http', url: 'http://127.0.0.1:1234/mcp' }
        );
        for (const key of Object.keys(fixture)) {
            if (key === 'mcpServers') { continue; }
            assert.deepStrictEqual(merged[key], fixture[key], `top-level key "${key}" was not preserved`);
        }
        const fixtureMcp = fixture.mcpServers as Record<string, unknown>;
        const mergedMcp = merged.mcpServers as Record<string, unknown>;
        for (const key of Object.keys(fixtureMcp)) {
            assert.deepStrictEqual(mergedMcp[key], fixtureMcp[key], `mcpServers.${key} was not preserved`);
        }
    });
});

suite('alreadyRegistered', () => {
    test('returns false for empty config', () => {
        assert.strictEqual(alreadyRegistered({}, 'http://127.0.0.1:1234/mcp'), false);
    });

    test('returns true when exact URL matches', () => {
        const config = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:1234/mcp' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp'), true);
    });

    test('returns true when localhost matches 127.0.0.1', () => {
        const config = { mcpServers: { myBrowser: { type: 'http', url: 'http://localhost:1234/mcp' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp'), true);
    });

    test('returns false when port differs', () => {
        const config = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:9999/mcp' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp'), false);
    });

    test('returns false when only other servers present', () => {
        const config = { mcpServers: { github: { type: 'stdio', command: 'npx' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp'), false);
    });

    test('returns true when token matches', () => {
        const config = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:1234/mcp?token=abc' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp?token=abc'), true);
    });

    test('returns false when config has no token but url has token', () => {
        const config = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:1234/mcp' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp?token=abc'), false);
    });

    test('returns false when tokens differ', () => {
        const config = { mcpServers: { integratedBrowser: { type: 'http', url: 'http://127.0.0.1:1234/mcp?token=old' } } };
        assert.strictEqual(alreadyRegistered(config, 'http://127.0.0.1:1234/mcp?token=new'), false);
    });
});
