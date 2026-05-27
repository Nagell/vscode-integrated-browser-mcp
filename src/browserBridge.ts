import * as vscode from 'vscode';
import type { CdpManager, BrowserTab } from './cdp/cdpManager.js';

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const BROWSER_TOOLS = {
    openBrowserPage: 'open_browser_page',
    readPage: 'read_page',
    screenshotPage: 'screenshot_page',
    navigatePage: 'navigate_page',
    clickElement: 'click_element',
    typeInPage: 'type_in_page',
    hoverElement: 'hover_element',
    dragElement: 'drag_element',
    handleDialog: 'handle_dialog',
    // No dedicated close_page LM tool exists; run_playwright_code is the only way to programmatically close a tab.
    runPlaywrightCode: 'run_playwright_code',
} as const;

let cdpManager: CdpManager | undefined;
let cdpFallbackLogged = false;

export function setCdpManager(manager: CdpManager): void {
    cdpManager = manager;
}

function logCdpFallback(err: unknown): void {
    if (!cdpFallbackLogged) {
        cdpFallbackLogged = true;
        console.warn(
            '[cdp] CDP unavailable — falling back to invokeTool (consent dialogs will appear). ' +
            'Run "Integrated Browser MCP: Enable CDP" to set up.', err
        );
    }
}

async function invoke(toolId: string, input: Record<string, unknown>): Promise<vscode.LanguageModelToolResult> {
    const cts = new vscode.CancellationTokenSource();
    try {
        return await vscode.lm.invokeTool(toolId, { input, toolInvocationToken: undefined }, cts.token);
    } finally {
        cts.dispose();
    }
}

function resultToMcp(result: vscode.LanguageModelToolResult): McpContent[] {
    const out: McpContent[] = [];
    for (const part of result.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            out.push({ type: 'text', text: part.value });
        } else if (part instanceof vscode.LanguageModelDataPart) {
            const b64 = Buffer.from(part.data).toString('base64');
            out.push({ type: 'image', data: b64, mimeType: part.mimeType });
        } else {
            console.warn('[browserBridge] unknown content part type dropped');
        }
    }
    return out;
}

function extractPageId(result: vscode.LanguageModelToolResult): string | undefined {
    for (const part of result.content) {
        if (!(part instanceof vscode.LanguageModelTextPart)) { continue; }
        // Happy-path format: "Page ID: <uuid>"
        const explicit = part.value.match(/Page ID:\s*(\S+)/);
        if (explicit) { return explicit[1]; }
        // "Already open" format from gate experiment:
        // "[ff15fad8-...] Title (URL) (active)"
        const existing = part.value.match(/\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/);
        if (existing) { return existing[1]; }
    }
    return undefined;
}

export interface VisibleBrowserTab {
    label: string;
    isActive: boolean;
    viewColumn?: number;
}

export function enumerateVisibleBrowserTabs(): VisibleBrowserTab[] {
    const tabs: VisibleBrowserTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'simpleBrowser.view') {
                tabs.push({ label: tab.label, isActive: tab.isActive, viewColumn: group.viewColumn });
            }
        }
    }
    return tabs;
}

export interface OpenPageResult {
    pageId: string;
    content: McpContent[];
}

export async function openBrowserPage(url?: string, forceNew?: boolean): Promise<OpenPageResult> {
    const input: Record<string, unknown> = {};
    if (url) { input.url = url; }
    if (forceNew) { input.forceNew = true; }
    const result = await invoke(BROWSER_TOOLS.openBrowserPage, input);
    const pageId = extractPageId(result);
    if (!pageId) {
        throw new Error('open_browser_page did not return a Page ID');
    }
    if (cdpManager && url) {
        const win = vscode.window as unknown as { browserTabs?: BrowserTab[] };
        const tabs = win.browserTabs;
        if (tabs) {
            const norm = (u: string) => u.replace(/\/$/, '');
            const tab = tabs.find(t => norm(t.url) === norm(url));
            if (tab) { cdpManager.trackTab(pageId, tab); }
        }
    }
    return { pageId, content: resultToMcp(result) };
}

export async function readPage(pageId: string): Promise<McpContent[]> {
    const result = await invoke(BROWSER_TOOLS.readPage, { pageId });
    return resultToMcp(result);
}

export async function screenshotPage(pageId: string, ref?: string, selector?: string, fullPage?: boolean, waitMs?: number): Promise<McpContent[]> {
    if (fullPage || (waitMs !== undefined && waitMs > 0)) {
        const wMs = Number(waitMs) || 0;
        if (cdpManager) {
            try {
                const session = await cdpManager.ensureSession(pageId);
                if (wMs > 0) {
                    await session.evaluate(`await new Promise(r => setTimeout(r, ${wMs}));`);
                }
                const result = await session.send('Page.captureScreenshot', {
                    format: 'jpeg',
                    quality: 80,
                    ...(fullPage ? { captureBeyondViewport: true } : {}),
                }) as { data: string };
                return [{ type: 'image', data: result.data, mimeType: 'image/jpeg' }];
            } catch (err) { logCdpFallback(err); }
        }
        // invokeTool fallback
        const code = `${wMs > 0 ? `await page.waitForTimeout(${wMs}); ` : ''}return await page.screenshot({ type: 'jpeg', quality: 80, fullPage: ${Boolean(fullPage)} });`;
        const raw = await runPlaywrightCode(pageId, code);
        if (!raw) { throw new Error('screenshot_page: no data returned from run_playwright_code'); }
        const bytes = decodeBuffer(raw);
        const b64 = Buffer.from(bytes).toString('base64');
        return [{ type: 'image', data: b64, mimeType: 'image/jpeg' }];
    }
    const input: Record<string, unknown> = { pageId };
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    const result = await invoke(BROWSER_TOOLS.screenshotPage, input);
    return resultToMcp(result);
}

export async function navigatePage(pageId: string, type?: string, url?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId };
    if (type) { input.type = type; }
    if (url) { input.url = url; }
    const result = await invoke(BROWSER_TOOLS.navigatePage, input);
    return resultToMcp(result);
}

export async function clickElement(pageId: string, element: string, ref?: string, selector?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId, element };
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    const result = await invoke(BROWSER_TOOLS.clickElement, input);
    return resultToMcp(result);
}

export async function closePage(pageId: string): Promise<McpContent[]> {
    const result = await invoke(BROWSER_TOOLS.runPlaywrightCode, { pageId, code: 'await page.close();' });
    cdpManager?.removeTab(pageId);
    return resultToMcp(result);
}

export async function hoverElement(pageId: string, element: string, ref?: string, selector?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId, element };
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    const result = await invoke(BROWSER_TOOLS.hoverElement, input);
    return resultToMcp(result);
}

export async function dragElement(
    pageId: string,
    sourceElement: string,
    targetElement: string,
    sourceRef?: string,
    targetRef?: string,
    sourceSelector?: string,
    targetSelector?: string
): Promise<McpContent[]> {
    // VS Code's drag_element uses from*/to* naming, not source*/target*
    const input: Record<string, unknown> = { pageId, fromElement: sourceElement, toElement: targetElement };
    if (sourceRef) { input.fromRef = sourceRef; }
    if (targetRef) { input.toRef = targetRef; }
    if (sourceSelector) { input.fromSelector = sourceSelector; }
    if (targetSelector) { input.toSelector = targetSelector; }
    const result = await invoke(BROWSER_TOOLS.dragElement, input);
    return resultToMcp(result);
}

export async function handleDialog(pageId: string, action: 'accept' | 'dismiss', text?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId, acceptModal: action === 'accept' };
    if (text !== undefined) { input.text = text; }
    const result = await invoke(BROWSER_TOOLS.handleDialog, input);
    return resultToMcp(result);
}

export async function typeInPage(pageId: string, text?: string, key?: string, ref?: string, selector?: string, element?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId };
    if (text) { input.text = text; }
    if (key) { input.key = key; }
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    if (element) { input.element = element; }
    const result = await invoke(BROWSER_TOOLS.typeInPage, input);
    return resultToMcp(result);
}

// Extracts the `Result:` value from a run_playwright_code response, unwrapping one level
// of JSON string quoting when present (VS Code double-encodes string return values).
export function extractRpcResult(result: vscode.LanguageModelToolResult): string | undefined {
    for (const part of result.content) {
        if (!(part instanceof vscode.LanguageModelTextPart)) { continue; }
        const m = part.value.match(/^Result:\s*([\s\S]+?)(?:\nPage Title:|$)/);
        if (!m) { continue; }
        const raw = m[1].trim();
        if (raw.startsWith('"') && raw.endsWith('"')) {
            try { return JSON.parse(raw) as string; } catch { /* fall through */ }
        }
        return raw;
    }
    return undefined;
}

// Decodes a run_playwright_code Buffer return value to a Uint8Array.
// Accepts both `{"type":"Buffer","data":[...]}` and bare number-array JSON.
export function decodeBuffer(raw: string): Uint8Array {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
        throw new Error(`decodeBuffer: failed to parse Buffer JSON: ${raw.slice(0, 100)}`);
    }
    const arr = Array.isArray(parsed)
        ? (parsed as number[])
        : ((parsed as { type: string; data: number[] }).data);
    return new Uint8Array(arr);
}

export async function runPlaywrightCode(pageId: string, code: string): Promise<string | undefined> {
    const result = await invoke(BROWSER_TOOLS.runPlaywrightCode, { pageId, code });
    return extractRpcResult(result);
}

export async function evalJs(pageId: string, expression: string): Promise<string | undefined> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            return await session.evaluate(`return JSON.stringify(await (async()=>(${expression}))());`);
        } catch (err) { logCdpFallback(err); }
    }
    const code = `const fn = new Function('return (' + ${JSON.stringify(expression)} + ');'); return JSON.stringify(await page.evaluate(fn));`;
    return runPlaywrightCode(pageId, code);
}

export async function getDom(pageId: string, selector?: string): Promise<string | undefined> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            const s = JSON.stringify(selector ?? null);
            return await session.evaluate(`return (function(){ const s=${s}; return s ? document.querySelector(s)?.outerHTML??'' : document.documentElement.outerHTML; })();`);
        } catch (err) { logCdpFallback(err); }
    }
    const code = `return await page.evaluate(sel => sel ? document.querySelector(sel)?.outerHTML ?? '' : document.documentElement.outerHTML, ${JSON.stringify(selector ?? null)});`;
    return runPlaywrightCode(pageId, code);
}

export async function scrollPage(pageId: string, deltaX?: number, deltaY?: number, x?: number, y?: number): Promise<void> {
    const code = x !== undefined && y !== undefined
        ? `window.scrollTo(${Number(x)}, ${Number(y)});`
        : `window.scrollBy(${Number(deltaX ?? 0)}, ${Number(deltaY ?? 0)});`;
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            await session.evaluate(code);
            return;
        } catch (err) { logCdpFallback(err); }
    }
    await runPlaywrightCode(pageId, code);
}

export async function markdown(pageId: string, selector?: string): Promise<string | undefined> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            const sel = JSON.stringify(selector ?? null);
            const body = `
const sel = ${sel};
const bt = String.fromCharCode(96);
const root = sel
    ? document.querySelector(sel)
    : (document.querySelector('main') ?? document.body);
if (!root) { return sel ? 'Selector did not match any element' : ''; }
function walk(node) {
    if (node.nodeType === 3) { return node.textContent ?? ''; }
    if (node.nodeType !== 1) { return ''; }
    const tag = node.tagName;
    const ch = () => Array.from(node.childNodes).map(walk).join('');
    if (/^H[1-6]$/.test(tag)) { return '#'.repeat(parseInt(tag[1])) + ' ' + node.textContent.trim() + '\\n\\n'; }
    if (tag === 'P') { return ch() + '\\n\\n'; }
    if (tag === 'BR') { return '\\n'; }
    if (tag === 'A') { return '[' + ch() + '](' + (node.href ?? '') + ')'; }
    if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') { return bt + ch() + bt; }
    if (tag === 'PRE') {
        const cEl = node.querySelector('code');
        const lang = (cEl?.className ?? '').replace('language-', '');
        const text = (cEl ?? node).textContent ?? '';
        return bt + bt + bt + lang + '\\n' + text + '\\n' + bt + bt + bt + '\\n\\n';
    }
    if (tag === 'UL') { return Array.from(node.children).map(li => '- ' + li.textContent.trim() + '\\n').join('') + '\\n'; }
    if (tag === 'OL') { return Array.from(node.children).map(li => '1. ' + li.textContent.trim() + '\\n').join('') + '\\n'; }
    if (tag === 'BLOCKQUOTE') { return '> ' + ch().trim() + '\\n\\n'; }
    if (tag === 'IMG') { return '![' + (node.alt ?? '') + '](' + (node.src ?? '') + ')'; }
    return ch();
}
return walk(root).replace(/\\n{3,}/g, '\\n\\n').trim();`;
            return await session.evaluate(body);
        } catch (err) { logCdpFallback(err); }
    }
    const code = `return await page.evaluate((sel) => {
    const bt = String.fromCharCode(96);
    const root = sel
        ? document.querySelector(sel)
        : (document.querySelector('main') ?? document.body);
    if (!root) { return sel ? 'Selector did not match any element' : ''; }
    function walk(node) {
        if (node.nodeType === 3) { return node.textContent ?? ''; }
        if (node.nodeType !== 1) { return ''; }
        const tag = node.tagName;
        const ch = () => Array.from(node.childNodes).map(walk).join('');
        if (/^H[1-6]$/.test(tag)) { return '#'.repeat(parseInt(tag[1])) + ' ' + node.textContent.trim() + '\\n\\n'; }
        if (tag === 'P') { return ch() + '\\n\\n'; }
        if (tag === 'BR') { return '\\n'; }
        if (tag === 'A') { return '[' + ch() + '](' + (node.href ?? '') + ')'; }
        if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') { return bt + ch() + bt; }
        if (tag === 'PRE') {
            const cEl = node.querySelector('code');
            const lang = (cEl?.className ?? '').replace('language-', '');
            const text = (cEl ?? node).textContent ?? '';
            return bt + bt + bt + lang + '\\n' + text + '\\n' + bt + bt + bt + '\\n\\n';
        }
        if (tag === 'UL') { return Array.from(node.children).map(li => '- ' + li.textContent.trim() + '\\n').join('') + '\\n'; }
        if (tag === 'OL') { return Array.from(node.children).map(li => '1. ' + li.textContent.trim() + '\\n').join('') + '\\n'; }
        if (tag === 'BLOCKQUOTE') { return '> ' + ch().trim() + '\\n\\n'; }
        if (tag === 'IMG') { return '![' + (node.alt ?? '') + '](' + (node.src ?? '') + ')'; }
        return ch();
    }
    return walk(root).replace(/\\n{3,}/g, '\\n\\n').trim();
}, ${JSON.stringify(selector ?? null)});`;
    return runPlaywrightCode(pageId, code);
}

export async function emulate(pageId: string, width: number, height: number): Promise<void> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            await session.send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 0, mobile: false });
            return;
        } catch (err) { logCdpFallback(err); }
    }
    await runPlaywrightCode(pageId, `await page.setViewportSize({ width: ${Number(width)}, height: ${Number(height)} });`);
}

// Body for injecting console capture — used in CDP evaluate() calls.
const CONSOLE_INJECT_BODY = `if (window.__mcpConsole) return;
window.__mcpConsole = [];
for (const level of ['log','warn','error','info','debug']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
        try { window.__mcpConsole.push({ level, ts: Date.now(), args: args.map(a => { try { return String(a); } catch { return '[unstringifiable]'; } }) }); } catch {}
        orig(...args);
    };
}`;

// Idempotent injection snippet for runPlaywrightCode fallback path.
const CONSOLE_INJECT = `await page.evaluate(() => {
    if (window.__mcpConsole) return;
    window.__mcpConsole = [];
    for (const level of ['log','warn','error','info','debug']) {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            try { window.__mcpConsole.push({ level, ts: Date.now(), args: args.map(a => { try { return String(a); } catch { return '[unstringifiable]'; } }) }); } catch {}
            orig(...args);
        };
    }
});`;

export async function injectConsoleCapture(pageId: string): Promise<void> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            await session.evaluate(CONSOLE_INJECT_BODY);
            return;
        } catch (err) { logCdpFallback(err); }
    }
    await runPlaywrightCode(pageId, CONSOLE_INJECT);
}

export async function getConsole(pageId: string, levels?: string[]): Promise<string | undefined> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            await session.evaluate(CONSOLE_INJECT_BODY);
            const lvls = JSON.stringify(levels ?? null);
            return await session.evaluate(`const lvls = ${lvls}; const buf = window.__mcpConsole ?? []; return JSON.stringify(lvls && lvls.length > 0 ? buf.filter(e => lvls.includes(e.level)) : buf);`);
        } catch (err) { logCdpFallback(err); }
    }
    const code = `${CONSOLE_INJECT}
return await page.evaluate((lvls) => {
    const buf = window.__mcpConsole ?? [];
    return JSON.stringify(lvls && lvls.length > 0 ? buf.filter(e => lvls.includes(e.level)) : buf);
}, ${JSON.stringify(levels ?? null)});`;
    return runPlaywrightCode(pageId, code);
}

export async function clearConsole(pageId: string): Promise<void> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            await session.evaluate('window.__mcpConsole = [];');
            return;
        } catch (err) { logCdpFallback(err); }
    }
    await runPlaywrightCode(pageId, `await page.evaluate(() => { window.__mcpConsole = []; });`);
}

// Positive slice: clamp to [0, totalSlices-1]. Negative slice: wrap (e.g. -1 → last).
export function normalizeSlice(slice: number, totalSlices: number): number {
    return slice >= 0
        ? Math.min(slice, totalSlices - 1)
        : ((slice % totalSlices) + totalSlices) % totalSlices;
}

export async function screenshotSlice(pageId: string, slice: number, width?: number, height?: number): Promise<McpContent[]> {
    if (cdpManager) {
        try {
            const session = await cdpManager.ensureSession(pageId);
            if (width !== undefined && height !== undefined) {
                await session.send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 0, mobile: false });
            }
            const vpStr = await session.evaluate('return JSON.stringify({ vw: window.innerWidth, vh: window.innerHeight, scrollH: document.documentElement.scrollHeight });');
            const { vw, vh, scrollH } = JSON.parse(vpStr ?? '{"vw":1280,"vh":800,"scrollH":800}') as { vw: number; vh: number; scrollH: number };
            const totalSlices = Math.max(1, Math.ceil(scrollH / vh));
            const rawSlice = Number(slice);
            const normalizedSlice = rawSlice >= 0
                ? Math.min(rawSlice, totalSlices - 1)
                : ((rawSlice % totalSlices) + totalSlices) % totalSlices;
            const prevY = Number(await session.evaluate('return String(window.scrollY);') ?? '0');
            try {
                await session.evaluate(`window.scrollTo(0, ${normalizedSlice * vh});`);
                await session.evaluate(`await new Promise(r => setTimeout(r, 200));`);
                const result = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }) as { data: string };
                return [
                    { type: 'text', text: JSON.stringify({ totalSlices, scrollHeight: scrollH, viewportHeight: vh, viewportWidth: vw, slice: normalizedSlice }) },
                    { type: 'image', data: result.data, mimeType: 'image/jpeg' }
                ];
            } finally {
                await session.evaluate(`window.scrollTo(0, ${prevY});`);
            }
        } catch (err) { logCdpFallback(err); }
    }
    if (width !== undefined && height !== undefined) {
        await runPlaywrightCode(pageId, `await page.setViewportSize({ width: ${Number(width)}, height: ${Number(height)} });`);
    }
    const code = `
const vp = await page.viewportSize();
const vh = vp?.height ?? 800;
const vw = vp?.width ?? 1280;
const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
const totalSlices = Math.max(1, Math.ceil(scrollH / vh));
const rawSlice = ${Number(slice)};
const normalizedSlice = rawSlice >= 0
    ? Math.min(rawSlice, totalSlices - 1)
    : ((rawSlice % totalSlices) + totalSlices) % totalSlices;
const prevY = await page.evaluate(() => window.scrollY);
try {
    await page.evaluate(y => window.scrollTo(0, y), normalizedSlice * vh);
    await page.waitForTimeout(200);
    const image = await page.screenshot({ type: 'jpeg', quality: 80 });
    return JSON.stringify({ image, meta: { totalSlices, scrollHeight: scrollH, viewportHeight: vh, viewportWidth: vw, slice: normalizedSlice } });
} finally {
    await page.evaluate(y => window.scrollTo(0, y), prevY);
}`;
    const raw = await runPlaywrightCode(pageId, code);
    if (!raw) { throw new Error('screenshot_slice: no data returned'); }
    let parsed: { image: unknown; meta: { totalSlices: number; scrollHeight: number; viewportHeight: number; viewportWidth: number; slice: number } };
    try { parsed = JSON.parse(raw) as typeof parsed; } catch {
        throw new Error(`screenshot_slice: failed to parse result: ${raw.slice(0, 100)}`);
    }
    const bytes = decodeBuffer(JSON.stringify(parsed.image));
    const b64 = Buffer.from(bytes).toString('base64');
    return [
        { type: 'text', text: JSON.stringify(parsed.meta) },
        { type: 'image', data: b64, mimeType: 'image/jpeg' }
    ];
}
