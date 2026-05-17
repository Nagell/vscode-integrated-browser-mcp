import * as vscode from 'vscode';

const BROWSER_TOOLS = {
    openBrowserPage: 'open_browser_page',
    readPage: 'read_page',
    screenshotPage: 'screenshot_page',
    navigatePage: 'navigate_page',
    clickElement: 'click_element',
    typeInPage: 'type_in_page',
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

function resultToMcp(result: vscode.LanguageModelToolResult): { type: 'text'; text: string }[] | { type: 'image'; data: string; mimeType: string }[] {
    const out: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
    for (const part of result.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            out.push({ type: 'text', text: part.value });
        } else if (part instanceof vscode.LanguageModelDataPart) {
            const b64 = Buffer.from(part.data).toString('base64');
            out.push({ type: 'image', data: b64, mimeType: part.mimeType });
        }
    }
    return out as ReturnType<typeof resultToMcp>;
}

function extractPageId(result: vscode.LanguageModelToolResult): string | undefined {
    for (const part of result.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            const match = part.value.match(/Page ID:\s*(\S+)/);
            if (match) { return match[1]; }
        }
    }
    return undefined;
}

export interface OpenPageResult {
    pageId: string;
    content: ReturnType<typeof resultToMcp>;
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

export async function readPage(pageId: string): Promise<ReturnType<typeof resultToMcp>> {
    const result = await invoke(BROWSER_TOOLS.readPage, { pageId });
    return resultToMcp(result);
}

export async function screenshotPage(pageId: string, ref?: string, selector?: string): Promise<ReturnType<typeof resultToMcp>> {
    const input: Record<string, unknown> = { pageId };
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    const result = await invoke(BROWSER_TOOLS.screenshotPage, input);
    return resultToMcp(result);
}

export async function navigatePage(pageId: string, type?: string, url?: string): Promise<ReturnType<typeof resultToMcp>> {
    const input: Record<string, unknown> = { pageId };
    if (type) { input.type = type; }
    if (url) { input.url = url; }
    const result = await invoke(BROWSER_TOOLS.navigatePage, input);
    return resultToMcp(result);
}

export async function clickElement(pageId: string, element: string, ref?: string, selector?: string): Promise<ReturnType<typeof resultToMcp>> {
    const input: Record<string, unknown> = { pageId, element };
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    const result = await invoke(BROWSER_TOOLS.clickElement, input);
    return resultToMcp(result);
}

export async function closePage(pageId: string): Promise<ReturnType<typeof resultToMcp>> {
    try {
        const result = await invoke(BROWSER_TOOLS.runPlaywrightCode, { pageId, code: 'await page.close();' });
        return resultToMcp(result);
    } catch {
        return [{ type: 'text', text: 'Page removed from session (browser tab may still be visible).' }];
    }
}

export async function typeInPage(pageId: string, text?: string, key?: string, ref?: string, selector?: string, element?: string): Promise<ReturnType<typeof resultToMcp>> {
    const input: Record<string, unknown> = { pageId };
    if (text) { input.text = text; }
    if (key) { input.key = key; }
    if (ref) { input.ref = ref; }
    if (selector) { input.selector = selector; }
    if (element) { input.element = element; }
    const result = await invoke(BROWSER_TOOLS.typeInPage, input);
    return resultToMcp(result);
}
