import * as vscode from 'vscode';
import { McpBridgeServer } from './mcpServer.js';
import * as bridge from './browserBridge.js';

let server: McpBridgeServer | undefined;
let output: vscode.OutputChannel | undefined;

// Fire-and-forget: verifies the run_playwright_code response shape hasn't changed.
// At activation time there is usually no open page, so 'unverified' is the common outcome.
function runParseProbe(s: McpBridgeServer, out: vscode.OutputChannel): void {
    bridge.runPlaywrightCode('', 'return 42;').then(value => {
        if (value === '42') {
            s.parseContract.status = 'ok';
            out.appendLine('[startup] parse probe: ok');
        } else if (value !== undefined) {
            s.parseContract.status = 'diverged';
            s.parseContract.details = `Expected "42", got: ${value.slice(0, 100)}`;
            out.appendLine(`[startup] parse probe: DIVERGED — ${s.parseContract.details}`);
            vscode.window.showErrorMessage(
                'Integrated Browser MCP: VS Code response format may have changed. ' +
                'Tools relying on run_playwright_code will return errors. ' +
                'Please update the extension or report the issue.',
                'Open Issue'
            ).then(choice => {
                if (choice === 'Open Issue') {
                    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/itsbrex/vscode-integrated-browser-mcp/issues'));
                }
            });
        }
        // value === undefined: no Result: line — no open page, stay 'unverified'
    }).catch(() => {
        out.appendLine('[startup] parse probe skipped (no browser page ready)');
    });
}

export async function activate(context: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('Integrated Browser MCP');
    server = new McpBridgeServer(output);

    const cfg = vscode.workspace.getConfiguration('integratedBrowserMcp');
    const port: number = cfg.get('port') ?? 3100;
    const autoStart: boolean = cfg.get('autoStart') ?? true;

    if (autoStart) {
        try {
            await server.start(port);
            output.appendLine(`MCP server started on http://127.0.0.1:${port}/mcp`);
            runParseProbe(server, output);
        } catch (err) {
            output.appendLine(`Failed to start MCP server: ${err}`);
            // EADDRINUSE already shows a specific message from the server error handler.
            if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
                vscode.window.showErrorMessage(`Integrated Browser MCP: failed to auto-start — ${(err as Error).message ?? String(err)}`);
            }
        }
    }

    // Lazily-created shared channel for all diagnostic commands below.
    let debugOutput: vscode.OutputChannel | undefined;
    const getDebugChannel = () => {
        if (!debugOutput) {
            debugOutput = vscode.window.createOutputChannel('Browser MCP Debug');
            context.subscriptions.push(debugOutput);
        }
        return debugOutput;
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('integratedBrowserMcp.startServer', async () => {
            if (server?.port !== undefined) {
                vscode.window.showInformationMessage(`MCP server already running on port ${server.port}`);
                return;
            }
            try {
                await server!.start(port);
                vscode.window.showInformationMessage(`MCP server started on port ${server!.port}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to start MCP server: ${err}`);
            }
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.stopServer', async () => {
            try {
                await server?.stop();
                vscode.window.showInformationMessage('MCP server stopped');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to stop MCP server: ${err}`);
            }
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.listTools', () => {
            const ch = getDebugChannel();
            ch.appendLine('=== Registered LM Tools ===');
            ch.appendLine(vscode.lm.tools.map(t => t.name).join('\n'));
            ch.show();
        }),

        vscode.commands.registerCommand('integratedBrowserMcp.probeScreenshotSlice', async () => {
            const ch = getDebugChannel();
            ch.show();
            ch.appendLine('\n=== Probe: screenshot slice + emulate ===');
            const cts = new vscode.CancellationTokenSource();

            // Extract the value from run_playwright_code TextPart.
            // VS Code wraps returned values as: Result: <value>\nPage Title: ...
            // When the value is a quoted JSON string: Result: "..."
            // When the value is an object: Result: {...}
            function extractRpcResult(parts: readonly (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart | unknown)[]): string | undefined {
                for (const part of parts) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        const m = part.value.match(/^Result:\s*([\s\S]+?)(?:\nPage Title:|$)/);
                        if (m) { return m[1].trim(); }
                    }
                }
                return undefined;
            }

            try {
                // 1. Open page — print raw text to confirm pageId format
                ch.appendLine('\n[1] open_browser_page — raw output to confirm format');
                const openResult = await vscode.lm.invokeTool('open_browser_page', { input: { url: 'https://en.wikipedia.org/wiki/JavaScript' }, toolInvocationToken: undefined }, cts.token);
                for (const part of openResult.content) {
                    if (part instanceof vscode.LanguageModelTextPart) { ch.appendLine(`  RAW: ${part.value.slice(0, 400)}`); }
                }
                // Try both formats
                const rawText = openResult.content.find((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)?.value ?? '';
                const pageId = rawText.match(/Page ID:\s*(\S+)/)?.[1] ?? rawText.match(/pageId:\s*(\S+)/)?.[1];
                ch.appendLine(`  pageId (matched): ${pageId}`);
                ch.appendLine(`  format used: ${rawText.match(/Page ID:/) ? '"Page ID:"' : rawText.match(/pageId:/) ? '"pageId:"' : 'UNKNOWN'}`);
                if (!pageId) { ch.appendLine('ERROR: no pageId — cannot continue'); return; }

                // 2. Emulate: set viewport
                ch.appendLine('\n[2] run_playwright_code -> setViewportSize(1280, 800)');
                const emulateResult = await vscode.lm.invokeTool('run_playwright_code', {
                    input: { pageId, code: 'await page.setViewportSize({ width: 1280, height: 800 });' },
                    toolInvocationToken: undefined
                }, cts.token);
                ch.appendLine(`  result: ${extractRpcResult(emulateResult.content) ?? '(no result value)'}`);

                // 3. Confirm viewport with evaluate
                ch.appendLine('\n[3] run_playwright_code -> confirm viewport size');
                const vpResult = await vscode.lm.invokeTool('run_playwright_code', {
                    input: { pageId, code: `return JSON.stringify(await page.viewportSize());` },
                    toolInvocationToken: undefined
                }, cts.token);
                const vpRaw = extractRpcResult(vpResult.content);
                ch.appendLine(`  raw result: ${vpRaw}`);
                // Result may be a quoted string: "\"{ ... }\"" — unwrap one level if needed
                let vpJson = vpRaw;
                if (vpJson?.startsWith('"') && vpJson?.endsWith('"')) { try { vpJson = JSON.parse(vpJson); } catch { /* leave as-is */ } }
                ch.appendLine(`  viewport: ${vpJson}`);

                // 4. Get page dimensions
                ch.appendLine('\n[4] run_playwright_code -> page dimensions');
                const dimsResult = await vscode.lm.invokeTool('run_playwright_code', {
                    input: {
                        pageId,
                        code: `
                            const vp = await page.viewportSize();
                            const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
                            return JSON.stringify({ vw: vp?.width, vh: vp?.height, scrollH, slices: Math.ceil(scrollH / (vp?.height ?? 800)) });
                        `
                    },
                    toolInvocationToken: undefined
                }, cts.token);
                const dimsRaw = extractRpcResult(dimsResult.content);
                ch.appendLine(`  raw result: ${dimsRaw}`);
                let dimsJson = dimsRaw;
                if (dimsJson?.startsWith('"') && dimsJson?.endsWith('"')) { try { dimsJson = JSON.parse(dimsJson); } catch { /* leave as-is */ } }
                let dims: { vw: number; vh: number; scrollH: number; slices: number } | undefined;
                try { if (dimsJson) { dims = JSON.parse(dimsJson); } } catch { /* not JSON */ }
                ch.appendLine(`  parsed: ${JSON.stringify(dims)}`);

                // 5. Screenshot via run_playwright_code — extract Buffer from JSON
                ch.appendLine('\n[5] run_playwright_code -> screenshot (Buffer as JSON)');
                const shotResult = await vscode.lm.invokeTool('run_playwright_code', {
                    input: { pageId, code: `return await page.screenshot({ type: 'jpeg', quality: 80 });` },
                    toolInvocationToken: undefined
                }, cts.token);
                const shotRaw = extractRpcResult(shotResult.content);
                ch.appendLine(`  raw result prefix (200 chars): ${shotRaw?.slice(0, 200)}`);
                let imgBytes: Uint8Array | undefined;
                try {
                    if (shotRaw) {
                        const parsed = JSON.parse(shotRaw) as { type: string; data: number[] } | number[] | { type: string; data: number[] };
                        const arr = Array.isArray(parsed) ? parsed : (parsed as { type: string; data: number[] }).data;
                        imgBytes = new Uint8Array(arr);
                        ch.appendLine(`  decoded ${imgBytes.byteLength} bytes — first 4: [${imgBytes[0]},${imgBytes[1]},${imgBytes[2]},${imgBytes[3]}] (JPEG starts with 255,216)`);
                        ch.appendLine(`  is valid JPEG: ${imgBytes[0] === 255 && imgBytes[1] === 216 ? 'YES ✅' : 'NO ❌'}`);
                    }
                } catch (e) { ch.appendLine(`  Buffer parse error: ${e}`); }

                // 6. Slice screenshot: scroll to slice 1, capture, restore
                if (dims && dims.slices > 1) {
                    ch.appendLine(`\n[6] run_playwright_code -> slice 1 of ${dims.slices} (scroll + screenshot)`);
                    const sliceResult = await vscode.lm.invokeTool('run_playwright_code', {
                        input: {
                            pageId,
                            code: `
                                const vp = await page.viewportSize();
                                const vh = vp?.height ?? 800;
                                const prevY = await page.evaluate(() => window.scrollY);
                                await page.evaluate(y => window.scrollTo(0, y), vh);
                                await page.waitForTimeout(200);
                                const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
                                await page.evaluate(y => window.scrollTo(0, y), prevY);
                                return buf;
                            `
                        },
                        toolInvocationToken: undefined
                    }, cts.token);
                    const sliceRaw = extractRpcResult(sliceResult.content);
                    ch.appendLine(`  raw prefix (100 chars): ${sliceRaw?.slice(0, 100)}`);
                    try {
                        if (sliceRaw) {
                            const parsed = JSON.parse(sliceRaw) as { type: string; data: number[] } | number[];
                            const arr = Array.isArray(parsed) ? parsed : (parsed as { type: string; data: number[] }).data;
                            const bytes = new Uint8Array(arr);
                            ch.appendLine(`  slice decoded ${bytes.byteLength} bytes — valid JPEG: ${bytes[0] === 255 && bytes[1] === 216 ? 'YES ✅' : 'NO ❌'}`);
                        }
                    } catch (e) { ch.appendLine(`  slice Buffer parse error: ${e}`); }
                } else {
                    ch.appendLine(`\n[6] SKIPPED — page has ${dims?.slices ?? '?'} slice(s)`);
                }

                ch.appendLine('\n=== Probe complete ===');
            } catch (err) {
                ch.appendLine(`\nERROR: ${err}`);
            } finally {
                cts.dispose();
            }
        }),

        output
    );
}

export async function deactivate() {
    try {
        await server?.stop();
    } catch (err) {
        output?.appendLine(`[deactivate] error stopping MCP server: ${err}`);
    }
}
