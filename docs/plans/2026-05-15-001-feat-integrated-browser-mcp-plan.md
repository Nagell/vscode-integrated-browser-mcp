---
title: "feat: VS Code Integrated Browser MCP Extension"
type: feat
status: active
date: 2026-05-15
origin: docs/superpowers/plans/2026-05-15-vscode-integrated-browser-mcp.md
---

# feat: VS Code Integrated Browser MCP Extension

## Overview

A VS Code extension that exposes VS Code's built-in Integrated Browser as an MCP server, so
external agents (Claude Code, etc.) can navigate, read, screenshot, and interact with web pages
inside the editor. The extension starts an HTTP MCP server inside VS Code's extension host process
on a configurable local port; Claude Code connects to it via its `type: "http"` MCP config.

> **Companion to:** `docs/superpowers/plans/2026-05-15-vscode-integrated-browser-mcp.md` — that
> document is a detailed execution guide. This plan captures the architectural decisions, corrects
> several implementation errors found in research, and is the definitive source for design rationale.

---

## Problem Frame

VS Code 1.110+ provides powerful browser agent tools (`openBrowserPage`, `readPage`,
`screenshotPage`, `clickElement`, etc.) only to VS Code's built-in Copilot chat agent. Claude Code
runs as an external CLI process and has no access to these tools. Duplicating the browser
implementation (e.g., launching a separate Playwright browser) loses the visual feedback of the
in-editor panel — the key value of the Integrated Browser.

The solution is a bridge: a VS Code extension that runs inside the extension host (where VS Code
APIs are accessible), starts an MCP server, and proxies tool calls from external agents to VS Code's
internal browser capabilities.

---

## Requirements Trace

- R1. Claude Code can open URLs in VS Code's Integrated Browser via MCP tool calls
- R2. Claude Code can read page content (DOM text, current URL) via MCP
- R3. Claude Code can take screenshots of the browser page via MCP
- R4. Claude Code can interact with elements (click, type) via MCP
- R5. The extension auto-starts the MCP server on VS Code launch with no user steps
- R6. Port is configurable; startup failure (port in use) shows a clear error, not a silent crash
- R7. The extension is publishable to the VS Code Marketplace

---

## Scope Boundaries

- No authentication on the MCP server (localhost-only, single-user machine assumed; see Risks)
- No multi-window support in v1 — the extension runs in one VS Code window; behaviour with multiple windows is undefined
- No browser session isolation between tool calls — all tool calls share one browser context
- No streaming/incremental results — each tool call is request/response

### Deferred to Follow-Up Work

- Multi-window awareness: routing tool calls to the correct window's browser
- MCP auth (token header) for shared/remote environments
- `runPlaywrightCode` tool (arbitrary Playwright code — high power, high surface area, deferred)
- `hoverElement`, `dragElement`, `handleDialog` tools (low-priority interaction tools)

---

## Context & Research

### Architectural Constraint: HTTP Not Stdio

The MCP transport **must be HTTP**, not stdio. Stdio MCP servers are spawned as child processes by
the MCP client (Claude Code). A child process runs outside VS Code's extension host and has no
access to `vscode.*` APIs. The server must run *inside* the extension host to call
`vscode.lm.invokeTool`, `vscode.commands.executeCommand`, etc.

HTTP is the only transport where the server is a pre-running process that clients connect to,
allowing it to remain inside the extension host.

Reference: `@modelcontextprotocol/sdk` v1.x, `StreamableHTTPServerTransport` from
`@modelcontextprotocol/sdk/server/streamableHttp.js`.

### `vscode.lm.tools` Is Synchronous

`vscode.lm.tools` is declared as `readonly LanguageModelToolInformation[]` — a plain synchronous
array, not a `Thenable`. The current `src/extension.ts` scaffold has `await vscode.lm.tools` which
is semantically wrong (though harmless at runtime). Fix: remove the `await`.

### `invokeTool` Outside Chat Context

`vscode.lm.invokeTool` can be called outside of an active chat request. The
`toolInvocationToken` property of `LanguageModelToolInvocationOptions` accepts `undefined` for
non-chat callers. Confirmed by VS Code `vscode.d.ts` JSDoc: *"If the tool is being invoked outside
of a chat request, `undefined` should be passed."* No chat session is required.

### Whether Browser Tools Appear in `vscode.lm.tools` — Unconfirmed

The `vscode.lm.tools` array lists tools registered via `lm.registerTool()` from extensions. It is
**unconfirmed** whether VS Code's built-in workbench-level browser tools (added in v1.110) appear
in this array or are gated at the Copilot host level only. GitHub issue #313798 ("Browser: Enable
browser tools in Agent Host sessions", filed May 2026, milestone 1.119.0) explicitly states the
browser tools are still being expanded for more agent execution contexts — strongly implying they
may not be available to arbitrary third-party `invokeTool` callers as of May 2026.

This is the primary risk. **U1 exists solely to resolve this.**

### CDP Is Not Exposed by Default

VS Code's Integrated Browser does not expose a CDP port to external consumers. The `editor-browser`
debug type (v1.112+) is an internal debug adapter abstraction, not a raw CDP socket. To attach
Playwright via CDP, VS Code must be launched with `--remote-debugging-port=<port>`, which requires
user configuration and is not on by default.

### Simple Browser ≠ CDP Target

The existing plan's Task 3B contains a critical conceptual error: it calls
`simpleBrowser.api.open` (which opens the **old** webview-based Simple Browser — an `<iframe>`,
not a CDP target) and then attempts `playwright.chromium.connectOverCDP(...)` to that same browser.
This is impossible. The old Simple Browser has no CDP endpoint. The CDP approach only works against
the **new** Integrated Browser, which requires `--remote-debugging-port`.

### MCP HTTP Transport — Bugs in Existing Plan

Two bugs in Task 2's proposed `mcpServer.ts`:

1. **Stateless transport cannot be reused.** `StreamableHTTPServerTransport` with
   `sessionIdGenerator: undefined` (stateless mode) throws
   `"Stateless transport cannot be reused across requests"` if the same instance handles multiple
   POST requests. The existing plan creates one transport instance and re-uses it. **Fix:** use a
   stateful transport with session tracking, or create a new server+transport pair per request.
   For this extension, stateful is correct — browser state must persist across tool calls.

2. **`req.body` is undefined without body-parser.** `http.IncomingMessage` has no `.body`
   property. The plan passes `req.body` as the third arg to `handleRequest`. Without Express's
   `json()` middleware (or equivalent), this is always `undefined`. When `undefined`, the SDK
   falls back to parsing the body internally via the Web Standard Request API — which works but
   requires the underlying adapter to be set up correctly. **Fix:** use Express with `express.json()`
   middleware and `createMcpExpressApp()` helper, or explicitly read the body before calling
   `handleRequest`.

### Correct Claude Code HTTP MCP Config

Claude Code's HTTP MCP config requires the full path including the route, not just the port:

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

The existing plan omits the `/mcp` path. Config lives in `~/.claude.json` (user scope) or
`.mcp.json` in the project root (project scope). `~/.claude/settings.json` is **not** the correct
location for MCP servers in Claude Code.

### `invokeTool` Returns `LanguageModelToolResult`

The return type of `vscode.lm.invokeTool` is `LanguageModelToolResult`, which is an array of
content parts. Page text would likely be a `LanguageModelTextPart`; screenshot image data would
likely be a `LanguageModelDataPart` with base64-encoded PNG. The exact part types depend on how
VS Code's internal browser tools construct their results — this cannot be confirmed without running
the experiment (U1).

---

## Key Technical Decisions

- **HTTP transport over stdio**: Required by the architecture — see Context above. Stdio servers
  run outside the extension host and cannot call `vscode.*` APIs.

- **Stateful single-session transport over stateless per-request**: Browser page state (which page
  is open, navigation history) must persist across tool calls within an agent session. A new
  transport per request would lose that state. One session per connected Claude Code instance is
  the correct model.

- **Express + `express.json()` over raw `http.Server`**: Simplest correct way to handle body
  parsing for the MCP SDK. The `createMcpExpressApp()` helper from the SDK already includes it.

- **invokeTool as primary path, CDP as fallback**: invokeTool delegates browser implementation to
  VS Code; CDP bypasses it with Playwright. invokeTool requires the experiment (U1) to confirm.
  CDP requires user action (`--remote-debugging-port`) but is implementation-independent.

- **`/mcp` route on the HTTP server**: The MCP endpoint is `http://localhost:<port>/mcp`, not the
  root. This matches Claude Code's expected HTTP MCP convention and makes the server more
  extensible (can add `/health`, `/status` routes alongside).

- **Port default 3100**: Chosen to avoid conflicts with common dev servers (3000, 3001, 8080,
  8000). User-configurable via `integratedBrowserMcp.port` setting.

---

## Open Questions

### Resolved During Planning

- **Can `invokeTool` be called outside a chat request?** Yes — pass `undefined` for
  `toolInvocationToken`. Confirmed by VS Code `vscode.d.ts` JSDoc.
- **Is `vscode.lm.tools` synchronous?** Yes — `readonly LanguageModelToolInformation[]`. No await.
- **What MCP transport is correct for an in-extension server?** HTTP — stdio requires the client
  to spawn the server process, placing it outside the extension host.
- **Does Claude Code support HTTP MCP?** Yes — `type: "http"` with a full URL including path.
- **Is Simple Browser a valid CDP target?** No — it is a webview iframe, not a Chromium instance.

### Deferred to Implementation

- **Exact registered names of browser tools in `vscode.lm.tools`**: Documented as bare camelCase
  (`openBrowserPage`, etc.) but the internal registration key is unconfirmed. Discovered in U1.
- **Whether browser tools appear in `vscode.lm.tools` at all**: Issue #313798 suggests they may
  not yet be available to third-party `invokeTool` callers. U1 is the only way to find out.
- **What `LanguageModelToolResult` parts the browser tools return**: Text, image data, or
  structured content — unknown until U1 runs.
- **Correct CDP port for VS Code's Integrated Browser**: Does not exist by default. If needed,
  user must set `--remote-debugging-port` in VS Code's `argv.json`. Port scanning (9222–9230)
  detects any existing Electron debugging port, not necessarily VS Code's browser.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not code to
> reproduce.*

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host Process                                  │
│                                                                  │
│  extension.ts                                                    │
│    └─ activates on startup                                       │
│    └─ starts McpBridgeServer on port 3100                        │
│                                                                  │
│  McpBridgeServer (Express + MCP SDK)                             │
│    └─ POST /mcp  ─── StreamableHTTPServerTransport (stateful)    │
│    └─ GET  /mcp  ─── SSE stream (for server-sent events)         │
│    └─ DELETE /mcp ── session teardown                            │
│    └─ GET  /health ─ liveness check                              │
│                                                                  │
│  BrowserBridge (Path A — primary)                                │
│    └─ vscode.lm.invokeTool('openBrowserPage', {url}, token)      │
│    └─ vscode.lm.invokeTool('readPage', {}, token)                │
│    └─ vscode.lm.invokeTool('screenshotPage', {}, token)          │
│    └─ etc.                                                       │
│                                                                  │
│  CdpBridge (Path B — fallback if Path A blocked)                 │
│    └─ playwright.chromium.connectOverCDP('localhost:<port>')      │
│    └─ page.goto / page.content / page.screenshot / page.click    │
│    └─ requires VS Code launched with --remote-debugging-port      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP (localhost:3100/mcp)
                               │ MCP Streamable HTTP protocol
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code (CLI, external process)                             │
│    ~/.claude.json: mcpServers.integratedBrowser                  │
│      type: "http", url: "http://localhost:3100/mcp"              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Output Structure

```
src/
  extension.ts        — activation, lifecycle, command registration
  mcpServer.ts        — Express app, MCP SDK wiring, session management
  browserBridge.ts    — Path A: invokeTool proxy (add only if U1 confirms viability)
  cdpBridge.ts        — Path B: Playwright CDP (add only if U2 confirms CDP port available)
docs/
  plans/
    2026-05-15-001-feat-integrated-browser-mcp-plan.md  ← this file
  superpowers/plans/
    2026-05-15-vscode-integrated-browser-mcp.md         ← execution guide (companion)
  testing.md          — manual test runbook
```

---

## Implementation Units

- U1. **Experiment: Probe invokeTool viability for browser tools**

**Goal:** Determine whether VS Code's built-in browser agent tools are accessible via
`vscode.lm.invokeTool` from a third-party extension. This is a binary decision gate: the answer
determines whether Path A or Path B is built.

**Requirements:** Gate for R1–R4

**Dependencies:** None

**Files:**
- Modify: `src/extension.ts`

**Approach:**
- Fix the existing `await vscode.lm.tools` bug (remove `await` — it's synchronous)
- Add the debug command that lists all tool names from `vscode.lm.tools`
- Separately attempt to call a browser tool with `toolInvocationToken: undefined`
- Ensure `workbench.browser.enableChatTools` setting is enabled AND the Integrated Browser panel
  is open before running — tools may not register until the browser feature activates
- A successful call that returns a `LanguageModelToolResult` confirms Path A; a "tool not found"
  or "access denied" error means Path B

**Test scenarios:**
- Happy path: tool names containing `browser`/`page`/`navigate`/`screenshot` appear in the list
  → note the exact name strings for the 10 browser agent tools
- Edge case: list is empty → `workbench.browser.enableChatTools` is disabled; enable and retry
- Edge case: browser tools absent from list → may not appear until the Integrated Browser panel
  is opened; open it and retry
- Error path: `invokeTool` throws "tool not found" → tools are registered at host level only,
  not in the extension-visible `vscode.lm.tools` array; proceed to U2 (Path B) or accept
  limitation
- Error path: `invokeTool` throws "This tool must be called from within a chat/editing session"
  → Path A is structurally blocked; proceed to U2

**Verification:**
- One of three outcomes is definitively documented: (A) invokeTool works, (B) tools not visible
  or invokeTool throws, (C) tools visible but need a specific context to call

---

- U2. **MCP Server with correct stateful HTTP transport**

**Goal:** A correct, working Express + MCP SDK HTTP server running inside the extension host.
Fixes the two transport bugs from the existing plan's Task 2.

**Requirements:** R5, R6 (server starts reliably; port conflict shows a clear error)

**Dependencies:** None (parallel with U1)

**Files:**
- Create: `src/mcpServer.ts`
- Modify: `src/extension.ts`
- Test: `src/test/extension.test.ts`

**Approach:**
- Use Express with `express.json()` middleware (or `createMcpExpressApp` helper from the SDK) to
  handle body parsing correctly
- Use stateful `StreamableHTTPServerTransport` with a `sessionIdGenerator` (UUID) — one transport
  instance per connected session, not per request
- Track sessions in a `Map<string, StreamableHTTPServerTransport>` in `McpBridgeServer`
- Handle all three routes: `POST /mcp` (tool calls), `GET /mcp` (SSE stream), `DELETE /mcp`
  (session teardown)
- Add `GET /health` returning `{ status: 'ok', sessions: N }` — useful for debugging
- On port conflict (EADDRINUSE), surface a VS Code error notification with the port number; do not
  silently fail
- Register a `McpBridgeServer` instance in `extension.ts`; tear it down in `deactivate()`
- Tool handlers at this stage return stub text responses (bridged in U3/U4)

**Test scenarios:**
- Happy path: server starts on port 3100, `GET /health` returns 200 with `{ status: 'ok' }`
- Happy path: `POST /mcp` with valid JSON-RPC envelope returns a valid MCP response
- Edge case: port 3100 is in use → EADDRINUSE error is caught and shown as a VS Code error
  notification; extension continues running (server just doesn't start)
- Edge case: extension deactivates while a session is active → all transports are closed gracefully
- Edge case: client sends a session ID that doesn't exist → return 404 or a new session
- Integration: Claude Code connects to `http://localhost:3100/mcp` and lists available tools;
  the tool list includes at least `openBrowserPage`, `readPage`, `screenshotPage`, `clickElement`,
  `typeInPage`

**Verification:**
- `curl http://localhost:3100/health` returns 200 while extension is active
- `/mcp` does not list tools (development server running in Extension Development Host)

---

- U3. **Path A Bridge — invokeTool proxy** *(implement only if U1 confirms Path A)*

**Goal:** Wire MCP tool calls through to `vscode.lm.invokeTool` using the exact tool IDs
discovered in U1.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1 (tool IDs known), U2 (server exists)

**Files:**
- Create: `src/browserBridge.ts`
- Modify: `src/mcpServer.ts`

**Approach:**
- A `TOOL_IDS` map from logical names to the exact strings from `vscode.lm.tools`
- Each function calls `vscode.lm.invokeTool(id, { input, toolInvocationToken: undefined }, token)`
- The `LanguageModelToolResult` response is an array of parts; extract text parts as strings,
  data parts (images) as base64 strings to pass as MCP image content
- For `screenshotPage`: if the result is a `LanguageModelDataPart` with `mime === 'image/png'`,
  return MCP content `{ type: 'image', data: base64, mimeType: 'image/png' }`
- Wrap every call in try/catch; on error return MCP error content rather than throwing (a thrown
  error in an MCP tool handler closes the transport)

**Test scenarios:**
- Happy path: `openBrowserPage('https://example.com')` → VS Code Integrated Browser panel opens
  at example.com; tool returns confirmation text
- Happy path: `readPage()` after navigating to example.com → text content includes "Example Domain"
- Happy path: `screenshotPage()` → returns MCP image content with base64 PNG; Claude Code
  renders it as an image
- Edge case: browser panel is closed when `readPage()` is called → graceful error message, not
  a crash
- Edge case: `clickElement('.nonexistent')` → VS Code's browser tool returns an error part;
  bridge surfaces it as MCP error text, not a transport crash
- Error path: `invokeTool` throws → catch, log to extension output channel, return error MCP
  content to client

**Verification:**
- Claude Code can instruct "Open https://example.com, read the heading, take a screenshot" as a
  single agent session and all three succeed without error

---

- U4. **Path B Bridge — Playwright CDP** *(implement only if U1 confirms Path A is blocked)*

**Goal:** Wire MCP tool calls to the Integrated Browser via Playwright's CDP client, bypassing
`vscode.lm.invokeTool`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U2 (server exists). User must launch VS Code with `--remote-debugging-port`.

**Files:**
- Create: `src/cdpBridge.ts`
- Modify: `src/mcpServer.ts`
- Modify: `package.json` (add `playwright-core` dependency)

**Approach:**
- On first tool call, scan ports 9222–9231 for an open CDP WebSocket endpoint using a short TCP
  probe; connect via `playwright.chromium.connectOverCDP('http://127.0.0.1:<port>')`
- Filter browser contexts/pages to find the Integrated Browser's page (by URL or title heuristic)
  — not `simpleBrowser.api.open` (that opens the OLD Simple Browser, which has no CDP endpoint)
- Implement `openBrowserPage` by calling `vscode.commands.executeCommand` to open the Integrated
  Browser panel, then using CDP `page.goto()` to navigate
- Implement `readPage` via CDP `page.content()` + `page.evaluate(() => document.body.innerText)`
- Implement `screenshotPage` via CDP `page.screenshot({ type: 'png' })` → base64 → MCP image
- Implement `clickElement` via CDP `page.click(selector)`
- Implement `typeInPage` via CDP `page.keyboard.type(text)`
- If no CDP port found: surface a clear VS Code notification explaining how to add
  `--remote-debugging-port` to `argv.json` (VS Code's user data dir config), and return an error
  to the MCP client explaining the setup requirement

**Critical note on `simpleBrowser.api.open`:** Do NOT use this to "open the browser" before CDP.
The command opens the *old* Simple Browser (webview iframe), not the Integrated Browser, and has
no CDP endpoint. Use `vscode.commands.executeCommand('workbench.action.browser.open', url)` or
equivalent Integrated Browser command if one exists — or open the browser panel manually and
navigate via CDP `page.goto()`.

**Test scenarios:**
- Happy path: VS Code launched with `--remote-debugging-port=9222`; extension finds the port;
  `openBrowserPage('https://example.com')` navigates the Integrated Browser to example.com
- Edge case: no CDP port open → notification appears; MCP tool returns actionable error text
  explaining required VS Code startup config
- Edge case: multiple CDP targets found (VS Code window + extension dev host + browser) → select
  the correct target by filtering on page URL/title that matches the Integrated Browser panel
- Error path: `page.click('.nonexistent')` → Playwright throws; catch, return MCP error content

**Verification:**
- With `--remote-debugging-port=9222`, Claude Code can navigate, read, screenshot, and click
  without any invokeTool dependency

---

- U5. **Error handling, output channel, and resilience**

**Goal:** All tool call failures surface as MCP error text (not transport crashes); the extension
has an output channel for diagnostic logs; server recovers from unexpected errors.

**Requirements:** R6 (port conflict error), R5 (stable auto-start)

**Dependencies:** U2, U3 or U4

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/mcpServer.ts`
- Modify: `src/browserBridge.ts` or `src/cdpBridge.ts`

**Approach:**
- Create a single named `OutputChannel` ('Integrated Browser MCP') in `extension.ts`; pass it
  to `McpBridgeServer` for structured logging (not `console.log`)
- Wrap every MCP tool handler body in try/catch; on error log to the output channel and return
  `{ content: [{ type: 'text', text: 'Error: <message>' }], isError: true }`
- Log session open/close events and each tool call (tool name + arguments summary) at debug level
- On transport close (client disconnect), clean up the session map entry and log the event

**Test scenarios:**
- Error path: any bridge function throws an unexpected error → MCP tool returns error content;
  the MCP session remains open (not closed by the throw)
- Happy path: Output channel 'Integrated Browser MCP' is visible in VS Code Output panel and
  shows tool call activity

**Verification:**
- Deliberately breaking a bridge function (returning a rejected Promise) does not close the MCP
  connection — subsequent tool calls still succeed

---

- U6. **Client configuration and documentation**

**Goal:** Users can connect Claude Code to the running server with minimal setup; the extension's
README explains the configuration step.

**Requirements:** R7

**Dependencies:** U2 (correct port and route)

**Files:**
- Create: `README.md`
- Create: `docs/testing.md` (manual test runbook)

**Approach:**
- Document the exact Claude Code config: `type: "http"`, `url: "http://localhost:3100/mcp"`
- Note that `~/.claude.json` (not `~/.claude/settings.json`) is the correct file for user-scope
  MCP servers; `.mcp.json` in project root is the correct file for project-scope
- Document the prerequisite: `workbench.browser.enableChatTools: true` in VS Code settings
  (for Path A); or `--remote-debugging-port` setup (for Path B)
- Document all 5 exposed tools with descriptions and input parameters
- The test runbook (TC1–TC6) from the companion plan is sufficient; add TC7: verify `/health`
  returns 200

**Test scenarios:**
- Test expectation: none — this unit contains only documentation and a test runbook, not
  behavioral code

**Verification:**
- A new user can follow README from scratch and have Claude Code talk to the browser within
  5 minutes (excluding VS Code restart for setting changes)

---

## System-Wide Impact

- **Interaction graph:** The MCP server runs as a persistent HTTP listener inside VS Code's
  extension host. It has no interaction with other VS Code extensions unless they also register
  tools consumed via `invokeTool` (Path A). CDP bridge (Path B) attaches a Playwright client
  to VS Code's Electron process — attaching CDP to a running process can slow it if many targets
  are listened on simultaneously.
- **Error propagation:** MCP tool errors must be returned as `isError: true` content, not thrown.
  Thrown errors terminate the transport session. Implement try/catch at every tool boundary.
- **State lifecycle risks:** The `Map<sessionId, transport>` in `McpBridgeServer` grows on each
  new client connection and shrinks on `DELETE /mcp` or transport close. If a client disconnects
  without sending DELETE, the session leaks until extension restart. Add a session TTL or hook
  into the transport's `onclose` event to clean up.
- **API surface parity:** The extension exposes 5 of the 10 browser agent tools in v1. Adding
  more tools later requires only adding MCP tool registrations and corresponding bridge calls —
  the server infrastructure is shared.
- **Unchanged invariants:** The VS Code Integrated Browser itself is unchanged. This extension
  is a read-write proxy — it calls the same APIs a Copilot agent would use.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Browser tools not in `vscode.lm.tools` (issue #313798, May 2026) | U1 experiment confirms or denies. If denied, Path B (CDP) is the fallback. CDP requires user setup but is VS Code-version-independent. |
| `invokeTool` works but requires active Copilot subscription | U1 would surface this. Alternative: Path B requires no Copilot. |
| `--remote-debugging-port` not exposed by VS Code's Integrated Browser | Confirmed by research: not exposed by default. Path B requires adding it to `argv.json`. Surface this clearly in the error message — don't fail silently. |
| Port 3100 conflict with another dev tool | Configurable. On EADDRINUSE show a VS Code notification with instructions to change the port. |
| Session leak on client disconnect | Hook transport `onclose` event to remove from session map. Add a session TTL (e.g., 1 hour) as a safety net. |
| MCP SDK API mismatch (SDK evolves) | Pin `@modelcontextprotocol/sdk` to a specific minor version in `package.json`. Review on each VS Code release. |
| VS Code extension host reloads on extension change in dev mode | MCP server is restarted; Claude Code must reconnect. Acceptable in dev; transparent in prod. |
| localhost HTTP server accessible to any local process | Known limitation; acceptable for single-user developer machines. Document explicitly; defer auth to a follow-up. |
| Wrong `argv.json` path for different OSes (Windows vs Linux) | Document all three paths in README: Windows, macOS, Linux. |

---

## Documentation / Operational Notes

- `argv.json` locations for adding `--remote-debugging-port` (Path B setup):
  - Windows: `%APPDATA%\Code\User\argv.json`
  - macOS: `~/Library/Application Support/Code/User/argv.json`
  - Linux: `~/.config/Code/User/argv.json`
- After adding `--remote-debugging-port=9222`, VS Code must be fully restarted (not just reloaded)
- `workbench.browser.enableChatTools` is an **organization-managed setting** per VS Code docs —
  individual users can toggle it in Settings UI but IT policies may lock it. Document this.
- The extension should set a minimum VS Code engine version of `^1.112.0` (when `invokeTool`
  became stable) in `package.json`

---

## Sources & References

- **Origin document:** [docs/superpowers/plans/2026-05-15-vscode-integrated-browser-mcp.md](../superpowers/plans/2026-05-15-vscode-integrated-browser-mcp.md)
- [VS Code lm API reference — invokeTool](https://code.visualstudio.com/api/references/vscode-api#lm)
- [VS Code 1.110 release notes — Agentic browser tools](https://code.visualstudio.com/updates/v1_110)
- [Integrated browser docs](https://code.visualstudio.com/docs/debugtest/integrated-browser)
- [Browser agent testing guide](https://code.visualstudio.com/docs/copilot/guides/browser-agent-testing-guide)
- [MCP SDK — streamableHttp transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/streamableHttp.ts)
- [MCP SDK — stateless HTTP example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts)
- [Claude Code MCP configuration](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [GitHub issue #313798 — Browser tools in Agent Host sessions](https://github.com/microsoft/vscode/issues/313798)
- [GitHub issue #283959 — vscode.lm.tools missing MCP/extension tools](https://github.com/microsoft/vscode/issues/283959)
- [Community Discussion #152281 — invokeTool outside chat context working sample](https://github.com/orgs/community/discussions/152281)
- [Prior art: vscode-simple-browser-mcp](https://github.com/SaViGnAnO/vscode-simple-browser-mcp)
