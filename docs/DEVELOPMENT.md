<a id="development-top"></a>

# Development

<!-- TABLE OF CONTENTS -->
- [Development](#development)
  - [Documentation](#documentation)
  - [Architecture](#architecture)
  - [Permission dialog scope](#permission-dialog-scope)
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

MCP client (Claude Code, Cline, Continue.dev, …)
  └─ http://localhost:3100/mcp
```

Each connected MCP client session gets its own `StreamableHTTPServerTransport` instance and a `pages` map tracking open page IDs. Page IDs are assigned by VS Code and required by every browser tool call after `open_browser_page`.

<p align="right">(<a href="#development-top">back to top</a>)</p>

## Permission dialog scope

VS Code shows a consent dialog the **first time** a non-chat extension calls `vscode.lm.invokeTool()` for a given tool in a session. Subsequent calls to the same tool within the same session run silently — VS Code caches the trust decision.

**Confirmed behaviour (Phase 0 spike, VS Code 1.120):**

- 6 tool calls → 6 initial dialogs (one per distinct tool, fired on first use)
- After approving each tool once, the rest of the session is prompt-free
- Applies to both `open_browser_page` (a dedicated VS Code LM tool) and `run_playwright_code` (used by Tier B/C/D/E tools)

**No pre-authorization API exists** in VS Code 1.112–1.120 for non-chat extensions. There is no way to bulk-approve or suppress these dialogs programmatically.

**Design consequence:** Tier B/C/D/E tools (eval_js, get_dom, scroll, emulate, markdown, console capture) all route through the single `run_playwright_code` LM tool. This means a user approves one dialog for that entire tier on first use, rather than one dialog per new capability.

**What a user can do to reduce friction:**

- Trust the extension publisher in VS Code's extension trust UI — this does not suppress the dialog but may reduce the number of re-prompts across sessions in future VS Code versions.
- Accept all pending dialogs at session start by calling a Tier A and a Tier B tool once before the main workflow.

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

1. Compile: `pnpm run compile`
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
pnpm test
```

Runs automated tests inside VS Code's test extension host. Two categories:

**Unit / server tests** (`src/test/extension.test.ts`, port 3199) — cover HTTP infrastructure, MCP protocol, tool registration, and schema validation. Do **not** invoke VS Code browser tools.

**Integration tests** (`src/test/integration/tier-*.test.ts`, port 3198) — call real MCP tools end-to-end through `vscode.lm.invokeTool`. Each Tier has one happy-path test:

| File | Tier | Scenario |
|---|---|---|
| `tier-b.test.ts` | B | `eval_js` `1 + 1` → `"2"` |
| `tier-c.test.ts` | C | `screenshot_page` → JPEG bytes `0xFF 0xD8` |
| `tier-d.test.ts` | D | inject `<h1>Hello</h1>`, `markdown` → `# Hello` |
| `tier-e.test.ts` | E | `console.log("boom")` via eval_js, `get_console` → entry contains `boom` |

Integration tests **skip gracefully** if `open_browser_page` fails (i.e. no workbench renderer is available — `if (!pageId) { return; }`). This means they pass in unit-only CI runs but produce real coverage when VS Code has a display context (xvfb or local dev host).

### CI test environment

The GitHub Actions workflow (`.github/workflows/test.yml`) runs on a Linux runner using `xvfb-run -a pnpm test` to provide a virtual display. VS Code's extension host starts under Xvfb, which enables the integration tests to call `vscode.lm.invokeTool` and open real browser tabs.

**Debugging CI failures locally:**

```sh
# Run exactly as CI does (requires Xvfb)
xvfb-run -a pnpm test

# Run without Xvfb (integration tests skip gracefully, unit tests run normally)
pnpm test

# Run a single test file
pnpm test --grep "Tier B"
```

**If integration tests are skipped in CI** (all four tier suites pass but assertions are not reached): the workbench renderer is not opening the browser panel. Check:
1. `workbench.browser.enableChatTools: true` is set in `src/test/workspace/.vscode/settings.json`
2. The `lm-tool-availability` test is green (tools are registered)
3. `open_browser_page` is present in `vscode.lm.tools` but `invokeTool` fails — VS Code may require a panel to be opened first; add `vscode.commands.executeCommand('simpleBrowser.show', 'about:blank')` to `suiteSetup` in `_helpers.ts` if needed

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

**Expected:** One pageId in the list, response says "Page … removed from session."  
**If failing:** If the browser tab was already closed externally (e.g. by switching focus during a permission dialog), `close_page` still succeeds and removes the entry from the session. If VS Code cannot close the tab programmatically, the response will include "(browser tab may still be visible)" but `isError` is not set.

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
