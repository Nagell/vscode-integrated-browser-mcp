<a id="development-top"></a>

# Development

<!-- TABLE OF CONTENTS -->
- [Development](#development)
  - [Documentation](#documentation)
  - [Architecture](#architecture)
  - [Common commands](#common-commands)
  - [Project MCP config (.mcp.json)](#project-mcp-config-mcpjson)
  - [Running the extension](#running-the-extension)
  - [Testing](#testing)
    - [Automated tests](#automated-tests)
    - [Manual integration tests](#manual-integration-tests)
      - [TC1 — open + read + screenshot](#tc1--open--read--screenshot)
      - [TC2 — navigate to URL](#tc2--navigate-to-url)
      - [TC3 — back / forward / reload](#tc3--back--forward--reload)
      - [TC4 — click\_element by ref](#tc4--click_element-by-ref)
      - [TC5 — type\_in\_page + key](#tc5--type_in_page--key)
      - [TC6 — forceNew + list\_pages](#tc6--forcenew--list_pages)
      - [TC7 — screenshot with element ref](#tc7--screenshot-with-element-ref)
      - [TC8 — close\_page + list\_pages](#tc8--close_page--list_pages)
  - [Troubleshooting](#troubleshooting)
  - [Known limitations](#known-limitations)

## Documentation

- [VS Code Extension API — Language Model Tools](https://code.visualstudio.com/api/references/vscode-api#lm)
- [VS Code 1.110 release notes — Agentic browser tools](https://code.visualstudio.com/updates/v1_110)
- [Integrated Browser docs](https://code.visualstudio.com/docs/debugtest/integrated-browser)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP configuration](https://docs.anthropic.com/en/docs/claude-code/mcp)

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Architecture

The extension runs an HTTP MCP server inside VS Code's extension host process. This is the only viable transport — stdio servers are spawned as child processes by the MCP client, which puts them outside the extension host and cuts off access to `vscode.*` APIs.

```
VS Code Extension Host
  └─ McpBridgeServer (Express + MCP SDK, port 3100)
       └─ POST /mcp  ── StreamableHTTPServerTransport (one per session)
       └─ GET  /mcp  ── SSE stream
       └─ DELETE /mcp ─ session teardown
       └─ GET  /health ─ liveness check

  └─ BrowserBridge
       └─ vscode.lm.invokeTool('open_browser_page', ...)
       └─ vscode.lm.invokeTool('screenshot_page', ...)
       └─ ... (all 8 tools)
            │
            ▼
         VS Code's built-in browser agent tools
         (same tools Copilot uses internally)

Claude Code (external CLI)
  └─ .mcp.json → http://localhost:3100/mcp
```

Each connected Claude Code session gets its own `StreamableHTTPServerTransport` instance and a `pages` map tracking open page IDs. Page IDs are assigned by VS Code and required by every browser tool call after `open_browser_page`.

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Common commands

```sh
# Compile TypeScript
pnpm run compile

# Bundle for release (called automatically by vsce)
pnpm run bundle

# Compile in watch mode
pnpm run watch

# Run automated tests
pnpm test

# Lint
pnpm run lint
```

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Project MCP config (.mcp.json)

The `.mcp.json` file at the project root is a **Claude Code project-scoped MCP config**. It tells Claude Code (when run from this directory) to connect to the locally running MCP server on port 3100.

```json
{
  "mcpServers": {
    "integratedBrowser": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

This file is committed to the repo so that anyone cloning it gets the correct config automatically.  
It is excluded from the packaged `.vsix` via `.vscodeignore` — end users who install from the Marketplace configure their own `~/.claude.json` or project `.mcp.json`.

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Running the extension

1. Compile: `npm run compile`
2. Press **F5** in VS Code to launch the Extension Development Host
3. In the dev host window, open **User Settings (JSON)** and add:

   ```json
   "workbench.browser.enableChatTools": true
   ```

4. Open the Integrated Browser panel at least once (the browser tools register on first open)
5. Open a terminal in the dev host window and run `claude`
6. The `Integratedbrowser` MCP server should appear in Claude's tool list

The **Integrated Browser MCP** output channel (View → Output → select from dropdown) shows all tool calls and session events.

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Testing

### Automated tests

```sh
npm test
```

Runs 11 tests against a real `McpBridgeServer` instance started on port 3199 inside VS Code's test extension host. Covers:

- HTTP infrastructure (health endpoint, session lifecycle, error responses, EADDRINUSE)
- MCP protocol (all 8 tools registered, `list_pages` empty on fresh session, `close_page` succeeds with unknown page ID)

These tests do **not** invoke the VS Code browser tools — they test the server layer only. Full end-to-end browser testing requires the manual test runbook below.

<p align="right">(<a href="#development-top">back to top</a>)</p>

### Manual integration tests

Run these prompts in sequence inside a `claude` session opened from the dev host terminal. Each test depends on state from the previous one.

---

#### TC1 — open + read + screenshot

```
Open https://example.com in the integrated browser.
Read the page and take a screenshot. Report the pageId,
confirm the heading "Example Domain" appears, and confirm the screenshot renders.
```

**Expected:** pageId returned, heading found, screenshot displayed.  
**If failing:** Check `workbench.browser.enableChatTools: true` is set. Open the Integrated Browser panel. Check the output channel for errors.

---

#### TC2 — navigate to URL

```
Using the pageId from TC1, navigate to https://en.wikipedia.org/wiki/Main_Page.
Read the page and confirm the title contains "Wikipedia".
```

**Expected:** Title includes "Wikipedia, the free encyclopedia".

---

#### TC3 — back / forward / reload

```
Go back in the browser. Confirm we are back at example.com.
Go forward. Confirm we are at Wikipedia again.
Reload the page. Confirm it still shows Wikipedia.
```

**Expected:** All three transitions succeed.

---

#### TC4 — click_element by ref

```
Read the current Wikipedia page to get element refs.
Find a link and click it using its ref value.
Read the page after clicking to confirm navigation happened.
```

**Expected:** Page content changes after click.  
**If failing:** The `element` field (human description) is required alongside `ref`. If Claude omits it, VS Code rejects the call.

---

#### TC5 — type_in_page + key

```
Navigate to https://duckduckgo.com.
Read the page to find the search input ref.
Type "MCP protocol" into it, then press Enter.
Screenshot the results page.
```

**Expected:** Search results rendered, screenshot shows results.  
**If failing:** Try `selector: "input[name=q]"` instead of `ref` if the ref has changed.

---

#### TC6 — forceNew + list_pages

```
Open https://example.org in a new tab (forceNew: true).
List all pages. Confirm two distinct pageIds and URLs are returned.
```

**Expected:** Two pageIds listed.  
**If failing:** If only one pageId is returned, VS Code may have reused the existing tab. Check the output channel.

---

#### TC7 — screenshot with element ref

```
On the example.org page, read the page to get element refs.
Take a screenshot of just the heading element using its ref.
```

**Expected:** Cropped screenshot shows only the heading.

---

#### TC8 — close_page + list_pages

```
Close the example.org page.
List all pages. Confirm only one pageId remains.
```

**Expected:** One pageId in the list, response says "Page … closed."  
**If failing:** If the browser tab was already closed externally (e.g. by switching focus during a permission dialog), `close_page` still succeeds and removes the entry from the session.

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| MCP server not listed in Claude Code | Extension not started or wrong port | Check the output channel; verify `.mcp.json` URL matches the configured port |
| All tool calls return "tool not found" | `workbench.browser.enableChatTools` not enabled | Enable in VS Code Settings and reload the window |
| Tools listed but calls hang | Integrated Browser panel not opened | Open the panel once before invoking tools |
| Port 3100 in use | Another process on the port | Change `integratedBrowserMcp.port` in settings |
| Permission dialog when opening or closing a page | VS Code security default | Click **Allow**; read, screenshot, navigate, click, and type run without interruption |
| `pageId` expired / "Page not found" | Tab closed externally | Call `open_browser_page` again to get a fresh `pageId` |

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Known limitations

- **`list_pages` URL is stale after side-effect navigation** — the URL stored per page is updated on explicit `navigate_page` calls only. Clicks and form submissions that cause navigation are not tracked. Use `read_page` to get the live URL.
- **WSL + native Windows Claude Code** — `os.homedir()` in the extension host resolves to the WSL Linux home, not the Windows home. The planned U7 auto-configure feature will not work across this boundary. Add the MCP config manually to `%APPDATA%\Claude\claude.json` on the Windows side.
- **No multi-window support** — the server runs in one VS Code window. Tool calls always target that window's browser.
- **No MCP authentication** — the server listens on `127.0.0.1` only and is intended for single-user developer machines. Do not expose port 3100 externally.

<p align="right">(<a href="#development-top">back to top</a>)</p>
