# VS Code Integrated Browser MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that exposes VS Code's built-in Integrated Browser as an MCP server, so external agents like Claude Code can navigate, read, screenshot, and interact with web pages inside VS Code.

**Architecture:** A VS Code extension activates on startup, starts an HTTP MCP server on a configurable local port, and bridges MCP tool calls to VS Code's internal browser APIs. The primary path uses `vscode.lm.invokeTool()` to call VS Code's own built-in browser agent tools; if those are locked to Copilot-only context, a fallback uses `simpleBrowser.api.open` + direct CDP attachment via Playwright.

**Tech Stack:** TypeScript, VS Code Extension API (v1.112+), `@modelcontextprotocol/sdk`, `@vscode/test-electron` for tests, `vsce` for publishing.

---

## Background & Context

> Read this fully before touching code. It contains the research from the discovery session that justifies every architectural decision.

### The Two VS Code Browsers

VS Code has **two different embedded browser implementations** that coexist:

#### 1. Simple Browser (old, still alive)
- Built-in VS Code extension at `extensions/simple-browser/` in the VS Code source tree
- Implemented as a **webview panel** — essentially an `<iframe>` inside VS Code's Electron shell
- Constraints: no CORS bypass, no DevTools, no CDP access, cannot load most real websites
- Command: `simpleBrowser.show` — but `package.json` has `"when": "isWeb"` on the command palette entry, meaning **the palette entry is intentionally hidden on desktop VS Code** (it only shows in vscode.dev). The API command `simpleBrowser.api.open` has NO `when` clause and still works programmatically on desktop.
- **Key insight:** Microsoft didn't remove Simple Browser; they silently removed it from desktop UX while keeping the API alive for programmatic use and for vscode.dev. The Integrated Browser is the desktop replacement.
- Source: [simple-browser package.json](https://github.com/microsoft/vscode/blob/main/extensions/simple-browser/package.json)

#### 2. Integrated Browser (new, the target)
- Added in **VS Code 1.109 (January 2026)**
- Full Chromium browser embedded in VS Code's Electron shell via CDP (Chrome DevTools Protocol)
- Uses **Playwright** internally — `runPlaywrightCode` is one of its agent tools, which implies Playwright is the CDP bridge
- Supports DevTools, debugging via `editor-browser` debug type, self-signed certs, and agent control
- Debug launch config:
  ```json
  { "type": "editor-browser", "request": "launch", "url": "http://localhost:3000" }
  ```
- Sources:
  - [VS Code 1.109 release notes](https://code.visualstudio.com/updates/v1_109)
  - [Integrated Browser docs](https://code.visualstudio.com/docs/debugtest/integrated-browser)

### The Browser Agent Tools (VS Code 1.110+)

In **v1.110 (February 2026)**, VS Code added "Agentic browser tools" (experimental) behind the setting `workbench.browser.enableChatTools`. These are **VS Code built-in language model tools** (not MCP), registered internally and available to Copilot chat agents:

| Tool | Purpose |
|---|---|
| `openBrowserPage` | Open a URL in the integrated browser |
| `navigatePage` | Navigate to a new URL |
| `readPage` | Read DOM content of the current page |
| `screenshotPage` | Take a screenshot |
| `clickElement` | Click a DOM element |
| `hoverElement` | Hover |
| `dragElement` | Drag |
| `typeInPage` | Type text |
| `handleDialog` | Accept/dismiss dialogs |
| `runPlaywrightCode` | Execute arbitrary Playwright code |

These are registered as `LanguageModelTool` instances inside VS Code. The VS Code API `vscode.lm.invokeTool(name, options, token)` became **stable in v1.112** and allows any extension to call registered tools — IF the tool IDs are known and IF they're accessible outside Copilot context. The tool names above may or may not be the exact IDs (they might be prefixed, e.g. `vscode_openBrowserPage`).

**The key unknown:** Can a third-party extension call these tools via `vscode.lm.invokeTool`? Task 1 answers this.

Sources:
- [VS Code 1.110 release notes — Agentic browser tools](https://code.visualstudio.com/updates/v1_110)
- [Browser agent testing guide](https://code.visualstudio.com/docs/copilot/guides/browser-agent-testing-guide)
- [vscode.lm API reference](https://code.visualstudio.com/api/references/vscode-api#lm)

### Prior Art: vscode-simple-browser-mcp

A community project already does this for the **old** Simple Browser:
- Repo: https://github.com/SaViGnAnO/vscode-simple-browser-mcp
- Tools: `open_url`, `navigate`, `execute_javascript`, `get_console_logs`, `get_browser_state`
- **Note:** No releases published — likely a proof-of-concept or WIP. Review the source before assuming it works.
- **How it probably works:** Calls `simpleBrowser.api.open` via VS Code commands (the API command is still accessible on desktop even though the palette entry is hidden).
- **Limitation:** Simple Browser is a webview/iframe; `execute_javascript` claims to work but may be limited by the webview sandbox.

Study this project's source before building — the MCP wiring and VS Code command invocation patterns are directly reusable.

### The "Share with Agent" Feature

VS Code 1.110 added a "Share with Agent" button in the Integrated Browser toolbar. When clicked, it shares the current browser tab with VS Code's built-in Copilot agent. This is **hardwired to Copilot chat** — there is no public API for external agents to receive shared pages. However, the shared page is still just a CDP session — if we can attach to the same CDP endpoint, we get the same data.

---

## Architecture Decision: invokeTool vs CDP

**Path A (preferred):** `vscode.lm.invokeTool()` bridge
- If the built-in browser tools are callable from a third-party extension, just proxy them through MCP
- Extension becomes a thin protocol adapter; VS Code does all the browser work
- ~300 lines total

**Path B (fallback):** Direct CDP
- Open the Integrated Browser via `vscode.commands.executeCommand('workbench.action.openBrowser', ...)` or the `editor-browser` debug type
- Find the CDP websocket endpoint (Playwright exposes it internally; may need to scan localhost ports 9222–9230, or use Electron's remote debugging)
- Attach with `playwright.chromium.connectOverCDP(endpoint)`
- Implement tools using Playwright's API directly
- ~700 lines total, but works regardless of VS Code internals

**Path C (Simple Browser fallback):** If Integrated Browser CDP is inaccessible
- Use `simpleBrowser.api.open` to open pages in the old Simple Browser
- Limited: no screenshots, no real JS execution, no click simulation
- Only useful as a "read-only view" tool
- Not recommended as the target state, but useful to get something working fast

Task 1 determines which path to take.

---

## File Structure

```
vscode-integrated-browser-mcp/
├── src/
│   ├── extension.ts          # Activation, command registration, lifecycle
│   ├── mcpServer.ts          # MCP server setup, tool registration, HTTP listener
│   ├── browserBridge.ts      # Calls vscode.lm.invokeTool (Path A)
│   └── cdpBridge.ts          # Playwright CDP connection (Path B, add if needed)
├── docs/
│   └── superpowers/plans/
│       └── 2026-05-15-vscode-integrated-browser-mcp.md  ← this file
├── package.json              # Extension manifest + npm scripts
├── tsconfig.json
├── .gitignore
└── .vscodeignore
```

---

## Tasks

---

### Task 1: The Experiment — Discover Available LM Tool IDs

This task answers the critical question before any real implementation. Run it first.

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Enable the experiment command**

The scaffold already has `integratedBrowserMcp.listTools`. Enable the `workbench.browser.enableChatTools` setting in VS Code first:

Open VS Code Settings (Ctrl+,), search for `workbench.browser.enableChatTools`, and enable it.

- [ ] **Step 2: Install dependencies and compile**

```bash
cd /home/nagel/Projects_WSL/vscode-integrated-browser-mcp
npm install
npm run compile
```

Expected: `out/extension.js` created, no TypeScript errors.

- [ ] **Step 3: Launch Extension Development Host**

Press **F5** in VS Code with the `vscode-integrated-browser-mcp` folder open.
A new VS Code window ("Extension Development Host") opens with your extension loaded.

- [ ] **Step 4: Run the list-tools command**

In the Extension Development Host window:
- Open Command Palette (Ctrl+Shift+P)
- Run: `Integrated Browser MCP: List Available LM Tools (debug)`
- Check the "Browser MCP Debug" Output panel

- [ ] **Step 5: Record what you find**

Look for tool names containing: `browser`, `page`, `navigate`, `screenshot`, `click`

**If you find browser tools** → The tool IDs are exactly what you need. Note them, proceed to Task 2A (invokeTool path).

**If the tools list is empty or has no browser tools** → The browser tools may only appear after opening a browser tab or enabling Copilot chat. Try:
1. Open an Integrated Browser tab: Command Palette → `Browser: Open Integrated Browser`
2. Re-run the list-tools command

**If still no browser tools** → The `invokeTool` path is blocked. Proceed to Task 2B (CDP path). Update this plan with your findings.

- [ ] **Step 6: Try calling one tool**

Add this to `extension.ts` temporarily under the `listTools` command:

```typescript
const testInvoke = vscode.commands.registerCommand('integratedBrowserMcp.testInvoke', async () => {
    const token = new vscode.CancellationTokenSource().token;
    try {
        // Replace 'TOOL_ID_FROM_STEP_5' with the actual ID you found
        const result = await vscode.lm.invokeTool('TOOL_ID_FROM_STEP_5', {
            input: { url: 'https://example.com' }
        }, token);
        vscode.window.showInformationMessage(`Success: ${JSON.stringify(result)}`);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed: ${e}`);
    }
});
context.subscriptions.push(testInvoke);
```

Recompile, relaunch, run `Integrated Browser MCP: testInvoke` from the palette.

- [ ] **Step 7: Document findings here**

Update this plan section with:
- Tool IDs found
- Whether `invokeTool` succeeded or threw
- Error message if it failed
- Which path (A/B/C) to proceed with

- [ ] **Step 8: Commit**

```bash
cd /home/nagel/Projects_WSL/vscode-integrated-browser-mcp
git add -A
git commit -m "chore: initial scaffold + task 1 experiment"
```

---

### Task 2: MCP Server Foundation

Build the MCP server layer that Claude Code (or any MCP client) connects to. This is independent of which browser bridge you use.

**Files:**
- Create: `src/mcpServer.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write the MCP server skeleton**

Create `src/mcpServer.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as http from 'http';
import * as vscode from 'vscode';

export class BrowserMcpServer {
    private server: McpServer;
    private httpServer: http.Server | null = null;

    constructor() {
        this.server = new McpServer({
            name: 'vscode-integrated-browser',
            version: '0.0.1',
        });
        this.registerTools();
    }

    private registerTools() {
        this.server.tool(
            'openBrowserPage',
            'Open a URL in VS Code\'s Integrated Browser',
            {
                url: { type: 'string', description: 'URL to open' },
            },
            async ({ url }) => {
                // Implemented in Task 3
                return { content: [{ type: 'text', text: `TODO: open ${url}` }] };
            }
        );

        this.server.tool(
            'readPage',
            'Read the DOM content and text of the currently open browser page',
            {},
            async () => {
                return { content: [{ type: 'text', text: 'TODO: read page' }] };
            }
        );

        this.server.tool(
            'screenshotPage',
            'Take a screenshot of the current browser page',
            {},
            async () => {
                return { content: [{ type: 'text', text: 'TODO: screenshot' }] };
            }
        );

        this.server.tool(
            'clickElement',
            'Click a DOM element by CSS selector',
            {
                selector: { type: 'string', description: 'CSS selector for the element to click' },
            },
            async ({ selector }) => {
                return { content: [{ type: 'text', text: `TODO: click ${selector}` }] };
            }
        );

        this.server.tool(
            'typeInPage',
            'Type text into a focused or selected input element',
            {
                text: { type: 'string', description: 'Text to type' },
            },
            async ({ text }) => {
                return { content: [{ type: 'text', text: `TODO: type ${text}` }] };
            }
        );
    }

    start(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            this.httpServer = http.createServer(async (req, res) => {
                await transport.handleRequest(req, res, req.body);
            });
            this.server.connect(transport).then(() => {
                this.httpServer!.listen(port, '127.0.0.1', () => {
                    vscode.window.setStatusBarMessage(`Browser MCP: running on port ${port}`, 5000);
                    resolve();
                });
            }).catch(reject);
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.httpServer) {
                this.httpServer.close(() => resolve());
            } else {
                resolve();
            }
        });
    }
}
```

- [ ] **Step 2: Wire it into extension.ts**

Replace `src/extension.ts` content:

```typescript
import * as vscode from 'vscode';
import { BrowserMcpServer } from './mcpServer';

let mcpServer: BrowserMcpServer | null = null;

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('integratedBrowserMcp');
    const port: number = config.get('port', 3100);
    const autoStart: boolean = config.get('autoStart', true);

    const listTools = vscode.commands.registerCommand('integratedBrowserMcp.listTools', async () => {
        const tools = vscode.lm.tools;
        const channel = vscode.window.createOutputChannel('Browser MCP Debug');
        channel.appendLine('=== Registered LM Tools ===');
        tools.forEach(t => channel.appendLine(`${t.name}: ${t.description}`));
        channel.show();
    });

    const startCmd = vscode.commands.registerCommand('integratedBrowserMcp.startServer', async () => {
        if (mcpServer) {
            vscode.window.showInformationMessage('Browser MCP server already running');
            return;
        }
        mcpServer = new BrowserMcpServer();
        await mcpServer.start(port);
        vscode.window.showInformationMessage(`Browser MCP server started on port ${port}`);
    });

    const stopCmd = vscode.commands.registerCommand('integratedBrowserMcp.stopServer', async () => {
        if (!mcpServer) { return; }
        await mcpServer.stop();
        mcpServer = null;
        vscode.window.showInformationMessage('Browser MCP server stopped');
    });

    context.subscriptions.push(listTools, startCmd, stopCmd);

    if (autoStart) {
        mcpServer = new BrowserMcpServer();
        await mcpServer.start(port);
    }
}

export async function deactivate() {
    if (mcpServer) {
        await mcpServer.stop();
    }
}
```

- [ ] **Step 3: Compile and verify it starts**

```bash
npm run compile
```

Press F5 to launch Extension Development Host.

Open Command Palette → `Integrated Browser MCP: Start Server`.

Expected: Status bar shows "Browser MCP: running on port 3100" for 5 seconds.

- [ ] **Step 4: Verify the server responds**

In a terminal (outside VS Code):

```bash
curl -s http://localhost:3100/
```

Expected: Some response (even an error body is fine — proves the server is up).

- [ ] **Step 5: Configure Claude Code to connect**

Add to `~/.claude/settings.json` under `"mcpServers"`:

```json
"integratedBrowser": {
  "type": "http",
  "url": "http://localhost:3100"
}
```

Restart Claude Code. Run `/mcp` to verify the server appears.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: MCP server foundation with stub tools"
```

---

### Task 3A: Bridge — invokeTool Path (use if Task 1 succeeded)

Wire the stub tools from Task 2 to real `vscode.lm.invokeTool()` calls.

**Files:**
- Create: `src/browserBridge.ts`
- Modify: `src/mcpServer.ts`

- [ ] **Step 1: Create the bridge**

Create `src/browserBridge.ts` — replace `TOOL_IDS` with what Task 1 found:

```typescript
import * as vscode from 'vscode';

// Replace these with the actual IDs discovered in Task 1
const TOOL_IDS = {
    openBrowserPage: 'REPLACE_WITH_ACTUAL_ID',
    navigatePage: 'REPLACE_WITH_ACTUAL_ID',
    readPage: 'REPLACE_WITH_ACTUAL_ID',
    screenshotPage: 'REPLACE_WITH_ACTUAL_ID',
    clickElement: 'REPLACE_WITH_ACTUAL_ID',
    typeInPage: 'REPLACE_WITH_ACTUAL_ID',
};

async function invoke(toolName: keyof typeof TOOL_IDS, input: Record<string, unknown>) {
    const token = new vscode.CancellationTokenSource().token;
    const result = await vscode.lm.invokeTool(TOOL_IDS[toolName], { input }, token);
    return result;
}

export async function openBrowserPage(url: string): Promise<string> {
    const result = await invoke('openBrowserPage', { url });
    return JSON.stringify(result);
}

export async function readPage(): Promise<string> {
    const result = await invoke('readPage', {});
    return JSON.stringify(result);
}

export async function screenshotPage(): Promise<string> {
    // screenshotPage likely returns image data — handle accordingly
    const result = await invoke('screenshotPage', {});
    return JSON.stringify(result);
}

export async function clickElement(selector: string): Promise<string> {
    const result = await invoke('clickElement', { selector });
    return JSON.stringify(result);
}

export async function typeInPage(text: string): Promise<string> {
    const result = await invoke('typeInPage', { text });
    return JSON.stringify(result);
}
```

- [ ] **Step 2: Wire bridge into mcpServer.ts**

Replace all `TODO` bodies in the tool handlers in `src/mcpServer.ts`:

```typescript
import * as bridge from './browserBridge';

// In registerTools(), replace the stub implementations:

// openBrowserPage:
async ({ url }) => {
    const result = await bridge.openBrowserPage(url);
    return { content: [{ type: 'text', text: result }] };
}

// readPage:
async () => {
    const result = await bridge.readPage();
    return { content: [{ type: 'text', text: result }] };
}

// screenshotPage:
async () => {
    const result = await bridge.screenshotPage();
    return { content: [{ type: 'text', text: result }] };
}

// clickElement:
async ({ selector }) => {
    const result = await bridge.clickElement(selector);
    return { content: [{ type: 'text', text: result }] };
}

// typeInPage:
async ({ text }) => {
    const result = await bridge.typeInPage(text);
    return { content: [{ type: 'text', text: result }] };
}
```

- [ ] **Step 3: Compile and smoke-test from Claude Code**

```bash
npm run compile
```

Relaunch Extension Development Host (F5).

In Claude Code:
```
Open http://example.com in the VS Code browser
```

Expected: Integrated Browser panel opens with example.com. If it does, the whole pipeline works.

- [ ] **Step 4: Test screenshot returns image data**

Ask Claude Code:
```
Take a screenshot of the current browser page
```

Check whether the result includes base64 image data. If `screenshotPage` returns binary, you may need to wrap it as MCP image content:

```typescript
return {
    content: [{
        type: 'image',
        data: base64String,
        mimeType: 'image/png',
    }]
};
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire invokeTool browser bridge"
```

---

### Task 3B: Bridge — CDP Path (use if Task 1 failed)

If `vscode.lm.invokeTool` is blocked, use Playwright to attach to the Integrated Browser's CDP endpoint directly.

**Files:**
- Create: `src/cdpBridge.ts`
- Modify: `src/mcpServer.ts`
- Modify: `package.json` (add playwright dependency)

- [ ] **Step 1: Add Playwright dependency**

```bash
npm install playwright-core
```

- [ ] **Step 2: Find the CDP endpoint**

Add to `package.json` scripts:
```json
"find-cdp": "node -e \"const net=require('net'); for(let p=9222;p<=9230;p++){const s=net.connect(p,'127.0.0.1',()=>{console.log('CDP port:',p);s.destroy()});s.on('error',()=>{})}\""
```

Run while VS Code (with Integrated Browser open) is running:
```bash
npm run find-cdp
```

If a port is found, Playwright can connect to it. If nothing is found, VS Code is not exposing a remote debugging port — you'll need to launch VS Code with `--remote-debugging-port=9222` (add to `argv.json` or to the VS Code shortcut/launcher).

- [ ] **Step 3: Create the CDP bridge**

Create `src/cdpBridge.ts`:

```typescript
import { chromium, Browser, Page } from 'playwright-core';
import * as vscode from 'vscode';

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
    if (page) { return page; }

    // Try to find the CDP endpoint on common ports
    for (const port of [9222, 9223, 9224, 9225]) {
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            const contexts = browser.contexts();
            if (contexts.length > 0 && contexts[0].pages().length > 0) {
                page = contexts[0].pages()[0];
                return page;
            }
        } catch {
            // try next port
        }
    }
    throw new Error('No CDP endpoint found. Launch VS Code with --remote-debugging-port=9222');
}

export async function openBrowserPage(url: string): Promise<string> {
    // For CDP path, use VS Code's Simple Browser API to open the browser panel,
    // then navigate via CDP
    await vscode.commands.executeCommand('simpleBrowser.api.open', url);
    // Give VS Code a moment to open the panel
    await new Promise(r => setTimeout(r, 1000));
    const p = await getPage();
    await p.goto(url);
    return `Navigated to ${url}`;
}

export async function readPage(): Promise<string> {
    const p = await getPage();
    const content = await p.content();
    const text = await p.evaluate(() => document.body.innerText);
    return `URL: ${p.url()}\n\nText content:\n${text}\n\nHTML length: ${content.length} chars`;
}

export async function screenshotPage(): Promise<string> {
    const p = await getPage();
    const buffer = await p.screenshot({ type: 'png' });
    return buffer.toString('base64');
}

export async function clickElement(selector: string): Promise<string> {
    const p = await getPage();
    await p.click(selector);
    return `Clicked ${selector}`;
}

export async function typeInPage(text: string): Promise<string> {
    const p = await getPage();
    await p.keyboard.type(text);
    return `Typed: ${text}`;
}

export async function disconnect() {
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
    }
}
```

- [ ] **Step 4: Wire into mcpServer.ts**

Same as Task 3A Step 2 — import from `'./cdpBridge'` instead of `'./browserBridge'`.

- [ ] **Step 5: Compile and test**

```bash
npm run compile
```

Relaunch, then in Claude Code:
```
Open http://example.com in the browser
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: CDP browser bridge via Playwright"
```

---

### Task 4: Integration Smoke Tests

No unit tests for this kind of extension — the real test IS Claude Code talking to it. Document a repeatable manual test checklist that you run after any change.

**Files:**
- Create: `docs/testing.md`

- [ ] **Step 1: Write the test runbook**

Create `docs/testing.md`:

```markdown
# Manual Test Runbook

## Setup
1. Open VS Code with this extension loaded (F5 for dev, or install .vsix for prod)
2. Ensure `workbench.browser.enableChatTools` is enabled in VS Code settings
3. Verify MCP server appears in Claude Code: run `/mcp` — expect `integratedBrowser` listed

## Test Cases

### TC1: Open page
In Claude Code: "Open https://example.com in the VS Code browser"
Expected: VS Code Integrated Browser panel opens showing example.com

### TC2: Read page
In Claude Code: "What is the main heading on the current browser page?"
Expected: Claude responds with "Example Domain" (the h1 on example.com)

### TC3: Screenshot
In Claude Code: "Take a screenshot of the current browser page"
Expected: Claude shows or describes a screenshot of example.com

### TC4: Navigate
In Claude Code: "Navigate the browser to https://httpbin.org/json"
Expected: Browser shows JSON content

### TC5: Click
In Claude Code: "Click the first link on the page"
Expected: Browser navigates to the linked URL

### TC6: Restart resilience
Stop and restart VS Code. Verify MCP server auto-starts (check status bar or run Start Server command).
```

- [ ] **Step 2: Run all test cases**

Work through TC1–TC6 and mark which pass/fail. Note any failures in this file.

- [ ] **Step 3: Commit**

```bash
git add docs/testing.md
git commit -m "docs: add manual test runbook"
```

---

### Task 5: Publishing Prep

- [ ] **Step 1: Create a Microsoft/Azure DevOps account**

Go to https://marketplace.visualstudio.com/manage — sign in with a Microsoft account. Create a publisher ID (e.g. `yourusername`). Update `package.json` field `"publisher"` to match.

- [ ] **Step 2: Add marketplace metadata to package.json**

```json
{
  "icon": "images/icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOURUSERNAME/vscode-integrated-browser-mcp"
  },
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/YOURUSERNAME/vscode-integrated-browser-mcp/issues"
  }
}
```

- [ ] **Step 3: Create a 128×128 PNG icon**

Place at `images/icon.png`. A simple browser + plug icon works. Use any image editor or generate with an AI tool.

- [ ] **Step 4: Write README.md**

Document:
- What it does
- Requirements (VS Code 1.112+, `workbench.browser.enableChatTools` enabled)
- How to configure Claude Code's `settings.json` to connect
- The tool list (openBrowserPage, readPage, screenshotPage, clickElement, typeInPage)

- [ ] **Step 5: Install vsce and package**

```bash
npm install -g @vscode/vsce
vsce package
```

Expected: `vscode-integrated-browser-mcp-0.0.1.vsix` created.

- [ ] **Step 6: Install locally and test the packaged version**

```bash
code --install-extension vscode-integrated-browser-mcp-0.0.1.vsix
```

Restart VS Code and run through TC1–TC6 from `docs/testing.md`.

- [ ] **Step 7: Publish**

```bash
vsce publish
```

You'll be prompted for a Personal Access Token (PAT) — create one at https://dev.azure.com with `Marketplace (Publish)` scope.

- [ ] **Step 8: Verify on marketplace**

Go to https://marketplace.visualstudio.com/search?term=integrated+browser+mcp — confirm it appears within ~5 minutes.

- [ ] **Step 9: Commit version bump and tag**

```bash
git add -A
git commit -m "chore: bump to 0.1.0 for initial publish"
git tag v0.1.0
```

---

## Open Questions (update as you discover answers)

- [ ] What are the exact tool IDs for the built-in browser agent tools? (Answer in Task 1)
- [ ] Does `vscode.lm.invokeTool` work for built-in tools from a third-party extension?
- [ ] Does VS Code expose a CDP port by default, or does it need `--remote-debugging-port`?
- [ ] Does `screenshotPage` return PNG bytes or base64 or a URI?
- [ ] Are browser tools available when the Integrated Browser is closed (lazy-loaded)?

---

## Resources

- [VS Code Extension API — lm namespace](https://code.visualstudio.com/api/references/vscode-api#lm)
- [VS Code 1.110 release notes — Agentic browser tools](https://code.visualstudio.com/updates/v1_110)
- [Integrated Browser docs](https://code.visualstudio.com/docs/debugtest/integrated-browser)
- [Browser agent testing guide](https://code.visualstudio.com/docs/copilot/guides/browser-agent-testing-guide)
- [MCP SDK — @modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [Prior art: vscode-simple-browser-mcp](https://github.com/SaViGnAnO/vscode-simple-browser-mcp)
- [VS Code simple-browser source](https://github.com/microsoft/vscode/tree/main/extensions/simple-browser)
- [Publishing VS Code extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
