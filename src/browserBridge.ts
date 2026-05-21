import * as vscode from 'vscode';

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
    return { pageId, content: resultToMcp(result) };
}

export async function readPage(pageId: string): Promise<McpContent[]> {
    const result = await invoke(BROWSER_TOOLS.readPage, { pageId });
    return resultToMcp(result);
}

export async function screenshotPage(pageId: string, ref?: string, selector?: string, fullPage?: boolean, waitMs?: number): Promise<McpContent[]> {
    if (fullPage || (waitMs !== undefined && waitMs > 0)) {
        const wMs = Number(waitMs) || 0;
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
    const input: Record<string, unknown> = { pageId, sourceElement, targetElement };
    if (sourceRef) { input.sourceRef = sourceRef; }
    if (targetRef) { input.targetRef = targetRef; }
    if (sourceSelector) { input.sourceSelector = sourceSelector; }
    if (targetSelector) { input.targetSelector = targetSelector; }
    const result = await invoke(BROWSER_TOOLS.dragElement, input);
    return resultToMcp(result);
}

export async function handleDialog(pageId: string, action: 'accept' | 'dismiss', text?: string): Promise<McpContent[]> {
    const input: Record<string, unknown> = { pageId, action };
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
    const code = `const fn = new Function('return (' + ${JSON.stringify(expression)} + ');'); return JSON.stringify(await page.evaluate(fn));`;
    return runPlaywrightCode(pageId, code);
}

export async function getDom(pageId: string, selector?: string): Promise<string | undefined> {
    const code = `return await page.evaluate(sel => sel ? document.querySelector(sel)?.outerHTML ?? '' : document.documentElement.outerHTML, ${JSON.stringify(selector ?? null)});`;
    return runPlaywrightCode(pageId, code);
}

export async function scrollPage(pageId: string, deltaX?: number, deltaY?: number, x?: number, y?: number): Promise<void> {
    const code = x !== undefined && y !== undefined
        ? `window.scrollTo(${Number(x)}, ${Number(y)});`
        : `window.scrollBy(${Number(deltaX ?? 0)}, ${Number(deltaY ?? 0)});`;
    await runPlaywrightCode(pageId, code);
}

export async function emulate(pageId: string, width: number, height: number): Promise<void> {
    const code = `await page.setViewportSize({ width: ${Number(width)}, height: ${Number(height)} });`;
    await runPlaywrightCode(pageId, code);
}
