---
title: "feat: Tools expansion, structural refactor, and UX/adoption features"
type: feat
status: active
date: 2026-05-18
deepened: 2026-05-18
---

# feat: Tools expansion, structural refactor, and UX/adoption features

## Overview

Expand the MCP surface from 8 tools to ~20 tools, restructure the source tree before
the expansion lands, and address three product-level UX gaps:

1. Per-call VS Code consent prompts that fire for every `vscode.lm.invokeTool` call.
2. Externally-opened browser pages that have no `pageId` in our registry.
3. No mechanism for the user to hand a picked element from the Integrated Browser
   to the connected agent — Copilot has this, we don't.

The work is phased so that the refactor lands first (cheap, low-risk, removes friction
for everything else), investigation/UX work lands second (informs feature shape), and
tool expansion fans out from a stable foundation.

---

## Problem Frame

The extension currently exposes 8 of VS Code's 10 internal browser tools through MCP.
Confirmed experiments show that `run_playwright_code` unlocks a much wider surface
(eval, DOM, scroll, emulate, sliced screenshots, markdown, console capture) — none of
which competing extensions (e.g. thimo/integrated-browser-mcp, 22 tools, CDP-based) get
to do via VS Code's blessed tool path.

Two friction points block adoption:

1. **Per-call permission prompts** — every `vscode.lm.invokeTool()` call from a
   non-chat extension triggers a VS Code consent dialog. This is a VS Code behavior,
   not Claude Code's. It makes the extension borderline unusable for real workflows.
2. **Externally-opened pages are invisible** — when VS Code auto-opens a localhost URL
   clicked from a terminal, our session registry has no entry for it, so agents cannot
   target the tab.

Structural debt: [src/mcpServer.ts](src/mcpServer.ts) holds both HTTP server
infrastructure and every tool definition (currently 317 lines). Adding ~12 more tools
without splitting it first would push it past 700 lines and make every diff noisier
than it needs to be.

---

## Requirements Trace

- R1. Split `src/mcpServer.ts` so tool definitions live in `src/tools/*.ts`, each
  exporting a `registerXxxTools(server, ctx)` registrar; `mcpServer.ts` retains only
  HTTP server, sessions, and transport wiring.
- R2. Investigate VS Code APIs (1.112–1.120 stable + proposed) for any mechanism to
  pre-authorize `vscode.lm.invokeTool()` calls from a non-chat extension; document
  findings and either implement the fix or record the workaround taken.
- R3. On extension activation, detect whether our MCP entry is present in the user's
  Claude Code config; offer a one-time notification with an "Add to Claude Code"
  button that merges (never overwrites) the config file.
- R4. Allow agents to take control of browser tabs the user already has open
  (terminal link clicks, debug sessions, manual `Simple Browser: Show`, etc.)
  via an `attach_visible_page` tool that re-invokes `open_browser_page` so VS
  Code emits a real pageId driving the full tool surface.
- R5. Expose Tier A tools (`hover_element`, `drag_element`, `handle_dialog`) by
  bridging existing VS Code LM tools.
- R6. Expose Tier B tools (`eval_js`, `get_dom`, `scroll`, `emulate`, `get_url`)
  built on `run_playwright_code` (except `get_url`, which is a trivial registry
  getter). After U17 lands, Tier B tools route through CDP `Runtime.evaluate`;
  `run_playwright_code` becomes the fallback path only.
- R7. Improve `screenshot_page` with `fullPage` and `waitMs` options; add a new
  `screenshot_slice` tool with Pythonic negative slice indexing and guaranteed
  scroll restoration.
- R8. Expose a `markdown` tool that walks the DOM via in-page JS (no npm
  dependency) and returns markdown scoped to `<main>` / `<body>` / custom selector.
- R9. Expose `get_console` and `clear_console` tools backed by an injected console
  capture script auto-installed on `open_browser_page`.
- R10. Remove the debug-only probe command and the corresponding `package.json`
  contribution before the next published release; replace it with documented
  agent-driven probe guidance in `docs/DEVELOPMENT.md`.
- R11. All new tools follow project conventions: `import type` for type-only imports,
  interfaces over types for object shapes, no `any`, conventional commits, no Claude
  attribution in commit messages.
- R12. Support multiple concurrent VS Code windows running the extension. Each
  window's MCP server is reachable on its own port without manual configuration;
  agents can discover all running instances via a per-user registry file.
- R13. When the user selects an element in the Integrated Browser, push the
  element's data (screenshot + accessible name + computed styles snapshot +
  position rect + innerText) via the SSE channel to MCP sessions that have
  opted in by calling `subscribe_element_selection`. If no session is
  subscribed, surface a clear in-product notification explaining the missing
  wiring rather than dropping silently.

---

## Scope Boundaries

- **Partial CDP (Approach B)**: Tier A tools (`open_browser_page`, `read_page`,
  `screenshot_page`, `navigate_page`, `click_element`, `type_in_page`, `hover_element`,
  `drag_element`, `handle_dialog`, `close_page`) remain as `vscode.lm.invokeTool()` calls — each fires
  once per VS Code session, then caches silently. Tiers B/C/D/E switch from
  `run_playwright_code` to CDP `Runtime.evaluate` (U17), eliminating per-unique-script
  consent dialogs. Full CDP replacement of Tier A is out of scope here — it would require
  re-implementing VS Code's accessibility tree and element-ref system.
- Not introducing third-party DOM-to-markdown libraries (Turndown, Readability) —
  markdown is implemented as ~80 lines of in-page JS evaluated via CDP `Runtime.evaluate`
  (U17); `run_playwright_code` is the fallback path only.
- Not implementing the network capture / download tools that the competing extension
  exposes — those depend on CDP and are out of scope here.
- Not changing the existing `read_page` output format — VS Code's pre-formatted
  accessibility tree (with `ref` IDs usable by `click_element`) is a competitive
  advantage worth preserving.
- Not implementing MCP server-initiated push notifications for page adoption in this
  plan — passive registration (so `list_pages` includes externally-opened pages) is
  the v1 deliverable. Push is deferred unless the investigation in U6 finds it cheap.
- Not adding MCP authentication — the server stays bound to `127.0.0.1` for a single
  developer machine, as documented in `Known limitations`.

### Deferred to Follow-Up Work

- MCP push notifications when a page is adopted: deferred to a follow-up PR if the
  investigation in U6 shows it requires meaningful protocol work beyond the SSE
  transport's existing support.
- Network capture, download tracking, and tab management tools (`browser_tabs_*`):
  deferred to a future iteration; would likely require CDP and is out of scope here.
- Cross-WSL/Windows config writer for the auto-register feature: `Known limitations`
  in `docs/DEVELOPMENT.md` already documents this; out of scope for U5.

### Deferred / Open Questions — From 2026-05-26 Review

- **U15 scope vs. solo-dev use case:** U15 (multi-window support) adds `portRegistry.ts`,
  a lockfile dependency, modifies already-complete U5 code, and introduces a QuickPick
  disambiguation flow. No concrete user-pain evidence cited. The collision-avoidance fix
  (retry with port 0 on `EADDRINUSE`) could be added to `mcpServer.ts` in ~5 lines
  without the registry feature. Revisit whether full U15 is worth the complexity vs.
  the minimal port-0 fallback only.

- **`CdpSession` abstraction vs. inline tab record:** `CdpSession` is never instantiated
  independently of `CdpManager` and has no test that doesn't mock its internals. Consider
  merging into a private `type CdpTabHandle = { evaluate, send, dispose }` inside
  `CdpManager` to eliminate one file and one class boundary with no behavioral change.
  Decide during U17 implementation once the `--remote-debugging-port` gate experiment passes.

- **CDP session WebSocket scope (security):** When U17 connects via `--remote-debugging-port`,
  the DevTools endpoint at `http://localhost:<port>/json/list` is accessible to any local
  process that can reach that port. Confirm during the gate experiment whether Electron
  binds to `127.0.0.1` only (standard) or `0.0.0.0`. Document in `docs/DEVELOPMENT.md`
  Known Limitations: "CDP via `--remote-debugging-port` grants full programmatic access to
  the browsing context (JS, DOM, cookies, storage) to any local process that can reach the
  port. The port is `127.0.0.1`-only by default; do not expose it externally."

- **MCP server no auth + DNS rebinding risk:** The server binds to `127.0.0.1` with no
  token. Combined with `eval_js`, any local process (or a browser tab exploiting DNS
  rebinding) can invoke arbitrary JS. Mitigation: add a random session token to the MCP
  URL written to `~/.claude.json` (e.g. `http://127.0.0.1:<port>/mcp?token=<128-bit>`).
  Token generation is trivial (`crypto.randomUUID()`); it defeats DNS rebinding and
  casual process enumeration. **⚠ BLOCKING for first public release** — add session token
  before publishing to the VS Code Marketplace. Add to Known Limitations in the meantime.

- **Console capture exfiltration:** `get_console` buffers all `console.*` output from
  the page and returns it to any MCP session that can reach the server. Pages may log
  auth tokens, PII, or secrets to the console. Add to the tool description and Known
  Limitations: "Console capture buffers all `console.*` output including potentially
  sensitive values. Do not use on pages handling credentials you haven't verified."

---

## Context & Research

### Relevant Code and Patterns

- [src/mcpServer.ts](src/mcpServer.ts) — current home of all 8 tool registrations.
  `errContent`, `createMcpServerInstance`, the `SessionEntry` / `PageInfo` interfaces,
  and the HTTP transport wiring all live here. The refactor splits these out.
- [src/browserBridge.ts](src/browserBridge.ts) — `invoke()`, `resultToMcp()`,
  `extractPageId()`, plus per-tool wrappers. New `runPlaywrightCode()` callers
  share helper code that belongs here: `extractRpcResult` (mirror of the probe's
  parser) and `decodeBuffer` (Buffer-as-JSON → `Uint8Array`).
- [src/extension.ts](src/extension.ts) — activation, command registration, and the
  `probeScreenshotSlice` command that confirmed the experiments behind this plan.
  The probe is the reference implementation for `extractRpcResult` and the screenshot
  slice flow.
- [src/test/extension.test.ts](src/test/extension.test.ts) — existing pattern for
  testing the MCP server layer without invoking VS Code's browser tools. New tools
  should follow the same approach: assert registration shape and contract behavior;
  do not stand up a real browser in CI.

### Institutional Learnings

- `docs/solutions/` does not currently exist in this repo. Document the most
  important findings of this work (extractRpcResult parse path, screenshot-slice
  scroll restore, consent-dialog scope) inline in `docs/DEVELOPMENT.md` once the
  investigation in U3/U6 resolves.

### External References

- [VS Code 1.112 release notes — Language Model Tools](https://code.visualstudio.com/updates/v1_112) —
  baseline for the `vscode.lm` API surface this extension uses; U3 needs to cross-
  check 1.113–1.120 for any new pre-authorization mechanism.
- [VS Code Extension API — Language Model Tools](https://code.visualstudio.com/api/references/vscode-api#lm) —
  authoritative reference for `invokeTool`, `toolInvocationToken`, and any related
  proposed API; U3 begins here.
- [thimo/integrated-browser-mcp](https://github.com/thimo/integrated-browser-mcp) —
  reference implementation of the alternative (CDP-based) approach with a 22-tool
  surface. Names like `browser_emulate`, `browser_markdown`, `browser_screenshot_slice`
  are well-known to agents and should bias our naming where it does not conflict.

---

## Key Technical Decisions

- **Refactor before expansion**: split `mcpServer.ts` into `src/tools/*.ts` as U2
  before adding any new tool. Each tool file exports `registerXxxTools(server, ctx)`
  with a context object `{ output, pages, bridge }`. Easier to land 12 small PRs on
  a clean shape than to retrofit a 700-line file.
- ~~**`run_playwright_code` is the workhorse for new tools**~~ — superseded by U17.
  Originally Tiers B/C/D/E routed through `run_playwright_code` to minimize consent
  dialogs, assuming VS Code cached consent per tool. U3 correction (2026-05-22) revealed
  caching is per **unique script content** — each distinct script (different `eval_js`
  expression, different `get_dom` selector, `CONSOLE_INJECT`, etc.) triggers its own
  dialog. U17 replaces `run_playwright_code` with CDP `Runtime.evaluate` for all
  Tier B/C/D/E calls, eliminating script-execution dialogs entirely.
- **Helpers live where they are reused**: `errContent` graduates to a small
  `src/util/mcpResult.ts`; `extractRpcResult` and `decodeBuffer` live in
  `src/browserBridge.ts` next to the LM-tool plumbing. No `wrapToolHandler` HOF
  unless duplication after the split is clearly >50 net lines.
- **Negative slice indexing for `screenshot_slice`**: Pythonic semantics (`slice = -1`
  is the last viewport). Implement with `(slice % totalSlices + totalSlices) %
  totalSlices` to handle both positive and negative inputs uniformly.
- **Scroll restore via `try/finally` always**: `screenshot_slice` mutates page state.
  Restore must run even on `await` rejection. The probe confirmed the basic flow but
  did not exercise the failure path.
- **Console capture is auto-injected on `open_browser_page`**: agents do not need to
  know it exists for it to work. The injection is best-effort; the limitation
  ("only captures output after injection") is documented in the tool description.
- **Shared zod schema fragments**: a small `src/tools/_schemas.ts` exports
  `pageIdSchema`, `refSchema`, `selectorSchema`, `elementSchema`. Lightweight
  reuse, no over-abstraction.
- **Tier A tool input schemas must be probed before implementation**: `hover_element`,
  `drag_element`, `handle_dialog` are read from `vscode.lm.tools[*].inputSchema` at
  development time; the implementation mirrors the schemas verbatim.
- **Hybrid CDP strategy (U17)**: Tier A tools remain as `vscode.lm.invokeTool` calls.
  This preserves VS Code's maintained accessibility tree (`read_page` with stable `ref`
  IDs) and its element-targeting for `click_element`/`type_in_page` — re-implementing
  these via CDP would be substantial work for no gain. Tier B/C/D/E tools (all
  script-execution paths: `eval_js`, `get_dom`, `scroll`, `emulate`, `markdown`,
  `get_console`, `clear_console`, `screenshot_slice`, `screenshot_page fullPage`,
  `close_page`) replace `run_playwright_code` with CDP `Runtime.evaluate`. The driver:
  `run_playwright_code` consent caches per unique script content — every distinct real
  tool call triggers its own dialog (see U3 correction). CDP eliminates this entirely.
  Tier A one-time dialogs (~5-6 at session start, then silent) are the accepted trade-off.
  **CDP access mechanism (gate result 2026-05-26):** `vscode.debug.onDidStartDebugSession`
  does NOT fire for the Simple Browser — it is a VS Code WebView panel, not a debug
  adapter target; `requestCDPProxy` is inaccessible. Correct mechanism: VS Code is
  Electron-based; launching with `--remote-debugging-port=<port>` (one-time addition to
  `~/.vscode/argv.json`) exposes all WebView targets — including the Simple Browser — at
  `http://localhost:<port>/json/list`. The extension connects via WebSocket to
  `target.webSocketDebuggerUrl` and sends `Runtime.evaluate` commands. Zero user setup
  beyond the one-time `argv.json` addition (automated by the `enableCdp` command in U17).
- **`.claude.json` (not `mcp_settings.json`) is the auto-register target on Linux/WSL**:
  the live config on this developer's machine is `~/.claude.json`. Linux/macOS path
  resolution: check `~/.claude.json` first (modern), then `~/.claude/mcp_settings.json`
  (legacy) — fall through to creating `~/.claude.json` when neither exists. Windows
  path is `%APPDATA%\Claude\claude.json` per Claude Code docs. Macro behavior, not
  exact path strings, is the contract — exact precedence verified during U5.

---

## Open Questions

### Resolved During Planning

- *Should we switch to CDP for parity with thimo's extension?* — Partial yes
  (Approach B / U17). Tier B/C/D/E tools replace `run_playwright_code` with CDP
  `Runtime.evaluate` to eliminate per-unique-script consent dialogs. Tier A tools
  remain as `invokeTool` calls to preserve VS Code's accessibility tree. Full CDP
  replacement (Tier A too) stays out of scope.
- *Should Tier B/C/D/E tools use `run_playwright_code` as the workhorse?* — No
  (corrected 2026-05-22, see U3 Correction). Per-unique-script consent caching
  makes this unviable: every distinct code string triggers its own dialog. U17
  replaces all `runPlaywrightCode()` call sites with CDP `Runtime.evaluate` for
  Tier B/C/D/E, eliminating the per-script dialog problem entirely.
- *Should markdown depend on Turndown?* — No. ~80 lines of in-page JS, no deps.
- *Should we adopt the per-tool `wrapToolHandler` HOF?* — Decide after the split
  lands (U2). Only adopt if it removes >50 net lines.
- *Where does the registrar context object live?* — `src/tools/_context.ts` exports
  the `ToolContext` interface (`{ output, pages, bridge, server }`) and is imported
  by every registrar.

### Strategic Questions Raised by Document Review (2026-05-18)

These are product-level / sequencing questions surfaced by the persona review
that the plan does not yet commit to. They do not block U1–U2 from starting
but should be answered before Phase 4 ramps up.

- **Tool-roster evidence**: which Tier B/C/D/E tools have concrete user-pain
  evidence (a GitHub issue, an agent workflow blocked today) vs. being driven
  by surface parity with `thimo/integrated-browser-mcp`? Candidates flagged
  for cut-or-defer if no evidence emerges: `markdown` (U11), `screenshot_slice`
  (U10), `eval_js` (U8).
- **v1 release boundary**: should the plan ship Phase 1+2+3 as a 0.3.x
  release, evaluate, then decide on Phase 4 — rather than treating all 15
  units as one roadmap? Solo-dev capacity argues yes.
- **Promote U6 and U14 earlier**: these are the units thimo's CDP approach
  structurally cannot match (VS Code-native page adoption, in-editor element
  handoff). Should they move ahead of the Tier A–E expansion in priority?
- **`eval_js` identity decision** — **Resolved (2026-05-26):** `eval_js` ships
  ungated. The extension is already an "arbitrary JS execution" surface via
  `run_playwright_code`; `eval_js` adds a more convenient interface, not new
  capability. The localhost-only binding + README security warning ("same trust
  model as DevTools console, do not expose to untrusted network") is the trust
  boundary. Adding a toggle would add friction with no real security benefit for
  the target user (a solo developer running the agent locally).

### Open Questions — From 2026-05-27 Review

- **Consent dialog adoption blocker (PL2):** The plan adds Tier B/C/D/E tools that each
  trigger additional consent dialogs before U17 ships. No adoption evidence cited for
  these tools. Before Phase 4 ramps up: validate that at least one Tier B/C/D/E tool
  has concrete user-pain evidence (GitHub issue, blocked agent workflow) rather than
  surface-parity motivation. If not, consider shipping Phase 4 incrementally after
  demand is confirmed.

- **CdpManager vs. single cdp.ts module (SG1):** The spec splits CDP into two files
  (`cdpSession.ts` + `cdpManager.ts`). `CdpSession` is never instantiated independently
  of `CdpManager`. Evaluate during U17 implementation (once the gate passes) whether
  a single `cdp.ts` with a private `type CdpTabHandle` is simpler. Decide before
  writing any CDP code.

- **U14 SSE push infrastructure scope (SG3):** U14 references `transport.send()` for
  push notifications. This assumes Claude Code holds the `GET /mcp` SSE stream open
  continuously. Before designing any broadcast plumbing: run the U14 gate (confirm
  `transport.send()` is reachable from a live Claude Code session). If not, U14 must
  be redesigned as a pull model (`get_element_selection` tool). Scope Path A (push)
  vs Path B (screenshot-only fallback) is undecided.

- **U15 portRegistry vs. 5-line EADDRINUSE retry (SG2 + ADV6):** U15 adds
  `portRegistry.ts`, a lockfile dependency, and a QuickPick disambiguation flow.
  No concrete multi-window user-pain evidence cited. A 5-line `EADDRINUSE` retry
  with port 0 in `mcpServer.ts` may satisfy the actual need. Revisit: is there a
  real user who has two VS Code windows with the extension running simultaneously?
  If not, defer U15 in favour of the minimal retry.

- **Per-tool user-pain evidence before Phase 5 (PL3):** Before investing in Phase 5
  (U17, U14, U15), confirm that Tier B/C/D/E tools are actually adopted and that
  consent dialogs are the primary blocker. If most usage is Tier A (open, read,
  screenshot, navigate, click, type), U17 may not be the highest-leverage investment.

- **U17 argv.json adoption friction (PL4):** The `enableCdp` command requires writing
  to `argv.json` and restarting VS Code — a non-trivial onboarding step. Evaluate
  whether automatic discovery (polling `/json/list` on well-known ports 9222/9229
  without requiring the user to set `argv.json` first) is feasible before finalising
  the UX. If VS Code is already running with `--remote-debugging-port`, the extension
  could connect without the setup command.

- **U14 gate — transport.send() reachability (PL5):** Must be validated before any
  U14 architecture is decided. If Claude Code disconnects after each tool call (no
  persistent SSE), the entire push model fails silently. Gate: start a real Claude
  Code session, fire a no-op `transport.send()`, confirm receipt. Result determines
  Path A vs Path B.

- **Consent dialog caching — empirical confirmation needed (ADV5):** The plan states
  "every distinct `run_playwright_code` code string triggers its own consent dialog."
  This premise drives the entire U17 motivation. Confirm empirically: does VS Code
  cache per tool name only, or per tool name + code string? If caching is per-tool
  name only, U17's urgency changes. Run the consent-dialog caching experiment before
  committing to U17 implementation.

- **U14 gate fallback — pull model scoping (ADV7):** If the U14 gate fails (SSE stream
  not held open), the pull model (`get_element_selection` polling tool) needs to be
  scoped before U14 begins. Define the polling interval, timeout, and user-visible
  feedback model before deciding U14 is viable at all.

- **Do-nothing baseline — ship Phase 4 with documented limitation vs. indefinite hold (ADV8):**
  If U17's gate fails and no alternative CDP approach is found, evaluate whether
  shipping Phase 4 Tier B/C/D/E tools with an explicit "one consent dialog per unique
  script" Known Limitations entry is better than waiting indefinitely. The dialog is a
  friction point, not a correctness issue. A shipped tool with friction beats an
  unshipped tool with no friction. Decide the threshold before Phase 5 begins.

### Deferred to Implementation

- The exact `inputSchema` shapes for `hover_element`, `drag_element`, and
  `handle_dialog` — probed live in U7 via `vscode.lm.tools`.
- The exact mechanism (if any) VS Code provides for pre-authorizing tool calls in
  1.112–1.120 — resolved in U3. The plan branches based on the outcome: if a fix
  exists, U3 implements it; if not, U3 documents the workaround and the rest of
  the plan stays as designed (route work through `run_playwright_code`).
- The exact event VS Code emits when an external page opens — resolved in U6.
  Plan branches: if a usable event exists, page adoption is real-time; if not,
  fall back to polling/lazy-resolve only on `list_pages` calls.
- Whether `extractRpcResult` should also extract `Page Title:` / `URL:` /
  `Snapshot:` fields — decided per-consumer in U4 based on whether call sites need
  them. Default helper returns just the `Result:` value.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review,
> not implementation specification. The implementing agent should treat it as
> context, not code to reproduce.*

**Module graph after the split:**

```
extension.ts
  └─ mcpServer.ts (HTTP + sessions + transport)
       └─ createMcpServerInstance(ctx)
            ├─ registerPageTools(server, ctx)        ── tools/page.ts
            ├─ registerInteractionTools(server, ctx) ── tools/interaction.ts
            ├─ registerVisualTools(server, ctx)      ── tools/visual.ts
            ├─ registerContentTools(server, ctx)     ── tools/content.ts
            └─ registerDiagnosticTools(server, ctx)  ── tools/diagnostic.ts
                                  │
                                  ▼
                         browserBridge.ts (invokeTool wrappers
                         + extractRpcResult + decodeBuffer)
                                  │
                                  ▼
                           vscode.lm.invokeTool(...)
```

**Page adoption sequence (U6, optimistic — pending API discovery):**

```
external trigger (terminal link, debug session, etc.)
  → VS Code opens Integrated Browser tab
  → vscode.<event>(handler)  ← discovered in investigation step
  → assign UUID pageId
  → for each active SessionEntry: session.pages.set(pageId, { url, openedAt })
  → (optional) push MCP notification via transport
```

---

## Implementation Units

- U1. **Extract shared helpers (errContent, schema fragments)** ✅ COMPLETE (2026-05-20)

**Goal:** Move `errContent` out of `mcpServer.ts` and create a small shared zod schema
fragments file. Both will be imported by every per-tool registrar in U2 and by every
new tool added in U7–U12, so they must exist before the split.

**Requirements:** R1, R11

**Dependencies:** None

**Files:**

- Create: `src/util/mcpResult.ts` — exports `errContent` and the `McpContent` re-export.
- Create: `src/tools/_schemas.ts` — exports `pageIdSchema`, `refSchema`, `selectorSchema`,
  `elementSchema` as named zod fragments.
- Create: `src/tools/_context.ts` — exports the `ToolContext` interface.
- Modify: `src/mcpServer.ts` — import `errContent` from the new module; delete the
  local definition.
- Modify: `src/browserBridge.ts` — re-export `McpContent` from the new util file so
  existing imports keep working with one hop of indirection (or move the type
  outright; decide during implementation).
- Test: `src/test/extension.test.ts` — extend existing test pattern to assert
  `errContent` returns `isError: true` with a text part.

**Approach:**

- Keep `McpContent` definition near its primary consumer; if browserBridge still
  needs it, re-export from there to avoid breaking the import chain.
- `ToolContext` shape: `interface ToolContext { output: vscode.OutputChannel; pages:
  Map<string, PageInfo>; }` — extend in later units.

**Patterns to follow:**

- Current `errContent` implementation in [src/mcpServer.ts:16-19](src/mcpServer.ts#L16-L19).

**Test scenarios:**

- Happy path: `errContent(new Error('boom'))` returns `{ content: [{ type: 'text',
  text: 'Error: boom' }], isError: true }`.
- Happy path: `errContent('string error')` formats the text identically.

**Verification:**

- `pnpm run compile` passes.
- `pnpm test` passes — no regression in existing tool-registration tests.

---

- U2. **Split mcpServer.ts → src/tools/ directory** ✅ COMPLETE (2026-05-20)

**Goal:** Move every `server.registerTool(...)` call out of `createMcpServerInstance`
into a `tools/*.ts` registrar. `mcpServer.ts` keeps HTTP, session, and transport
wiring; `createMcpServerInstance` becomes the registrar-orchestrator.

**Requirements:** R1, R11

**Dependencies:** U1

**Files:**

- Create: `src/tools/page.ts` — registers `open_browser_page`, `list_pages`,
  `close_page`, `navigate_page` (and `get_url` in U8).
- Create: `src/tools/interaction.ts` — registers `click_element`, `type_in_page`
  (and `hover_element`, `drag_element`, `handle_dialog`, `scroll` in later units).
- Create: `src/tools/visual.ts` — registers `screenshot_page` (and `screenshot_slice`,
  `emulate` in later units).
- Create: `src/tools/content.ts` — registers `read_page` (and `eval_js`, `get_dom`,
  `markdown` in later units).
- Create: `src/tools/diagnostic.ts` — empty registrar in this unit; populated in U12.
- Modify: `src/mcpServer.ts` — `createMcpServerInstance` calls each registrar in turn
  with a shared `ToolContext`.
- Test: `src/test/extension.test.ts` — verify the registered-tool list is unchanged
  (8 tools).

**Approach:**

- Atomic move: existing tool handler bodies copy verbatim into each registrar file
  with no behavioral changes. Lint and type-check after each registrar.
- `createMcpServerInstance` signature stays: `(output, pages) => McpServer` — wrap
  those args into a `ToolContext` before delegating.
- Note: U12 adds a side-effect to the `open_browser_page` handler (console
  capture auto-inject). U2 ships the handler unchanged from current behavior;
  U12 layers the injection on top without altering the tool's I/O contract.

**Execution note:** This is a characterization-friendly refactor — the existing
behavior is the spec. Run the full test suite after each registrar move; commit
only when green.

**Patterns to follow:**

- Existing `createMcpServerInstance` body in
  [src/mcpServer.ts:26-172](src/mcpServer.ts#L26-L172).

**Test scenarios:**

- Happy path: server initialization registers exactly the same 8 tools as before
  the split; tool names, descriptions, and schemas match the pre-refactor snapshot.
- Edge case: `pages` map state is shared across registrars within a single session
  (so `open_browser_page` in `page.ts` and `navigate_page` in `page.ts` see the
  same map).

**Verification:**

- `pnpm test` passes.
- `git diff src/mcpServer.ts` shows only deletions of tool blocks plus calls to
  the new registrars.
- Manual TC1–TC8 from `docs/DEVELOPMENT.md` still pass.

---

- U3. **Investigate and address per-call permission prompts** ✅ COMPLETE (2026-05-20)

**Goal:** Determine whether VS Code 1.112+ offers any mechanism to pre-authorize
`vscode.lm.invokeTool()` calls from a non-chat extension. Implement the fix if one
exists; otherwise, document the workaround and minimize per-call surface by routing
work through `run_playwright_code` where possible.

**Requirements:** R2

**Dependencies:** None (can run in parallel with U1/U2)

**Files:**

- Modify: `docs/DEVELOPMENT.md` — add a `## Permission dialog scope` section that
  documents the consent behavior, the workaround taken, and any user-facing setting
  that helps (e.g. trusting the extension publisher).
- Modify: `src/browserBridge.ts` — apply the fix if one exists (e.g. a new field on
  the `invokeTool` options bag, a proposed `vscode.lm` API, or a workspace trust
  signal). If no fix exists: confirm by experiment that `run_playwright_code` is
  prompted per-session rather than per-call, and add a comment in `browserBridge.ts`
  citing the finding.
- Modify: `package.json` — `engines.vscode` may need to bump if the fix is in a
  newer VS Code version. If using a proposed API, add `enabledApiProposals` and
  document the dev-mode requirement.

**Approach:**

- Investigation list (in order):
  1. Read VS Code 1.113–1.120 release notes section "Language Model Tools" and
     "Proposed APIs".
  2. List `vscode.lm` API surface in the current `@types/vscode` against the
     proposed API list at <https://github.com/microsoft/vscode/tree/main/src/vscode-dts>.
  3. Search VS Code source for `toolInvocationToken` usage to see how internal
     callers acquire one — specifically look at terminal link handlers and port
     forwarding.
  4. Experiment via the existing probe command: fire 5 `run_playwright_code` calls
     in a row and observe whether the consent dialog appears 1× or 5×.
  5. Experiment: fire calls to 3 distinct LM tools and observe whether consent is
     prompted per-tool or per-call.
- Decision branch:
  - If a structural fix exists, implement it.
  - If not, ensure new tools (Tiers B/C/D/E) all funnel through `run_playwright_code`
    to keep the consent prompt count to one per session.

**Results (2026-05-19):** Probe run confirmed **per-call consent on first invocation**.
6 dialogs for 6 calls (1 × `open_browser_page` + 5 × `run_playwright_code`). VS Code
caches trust per tool within the session — subsequent calls to the same tool run without
further prompts. No pre-authorization API exists in VS Code 1.112 for non-chat extensions.

**⚠ Correction (2026-05-22):** The probe used the same script (`return 42;`) for all
5 × `run_playwright_code` calls, making them appear session-cached. Manual testing with
the real extension showed VS Code caches consent per **unique script content**, not per
tool name — every distinct script (different `eval_js` expression, `get_dom` with a
selector, the multi-line `CONSOLE_INJECT`, etc.) triggers its own dialog. The "workhorse
routing" conclusion was wrong. **Decision: replace `run_playwright_code` with CDP
`Runtime.evaluate` for all Tier B/C/D/E tools (U17).**

**Execution note:** This unit is investigation-led. The first step is reading
release notes and the API surface, not writing code. Record findings in the
DEVELOPMENT.md section regardless of outcome.

**Test scenarios:**

- Test expectation: none — investigation outcomes are documented in
  `docs/DEVELOPMENT.md`. If a code fix lands, U3 inherits the relevant tool-call
  tests from later units.

**Verification:**

- `docs/DEVELOPMENT.md` includes a clear answer to: "How does the consent dialog
  scope (per-call, per-tool, per-session, per-extension)?" and "What can a user
  do to reduce its frequency?"
- If a fix lands: a manual session that exercises 3+ tool calls shows only the
  expected number of dialogs.

---

- U4. **Add run_playwright_code helpers to browserBridge** ✅ COMPLETE (2026-05-20)

**Goal:** Add `extractRpcResult` and `decodeBuffer` helpers to `src/browserBridge.ts`
so every Tier B/C/D/E tool uses the same parse path. The probe command in
`src/extension.ts` already contains a reference implementation. Add a startup
probe that verifies the parse contract on activation and surfaces breakage
both to the user (output channel) and to the agent (in tool responses).

**Requirements:** R6, R7, R8, R9

**Dependencies:** U2

**Files:**

- Modify: `src/browserBridge.ts` — add:
  - `extractRpcResult(result: vscode.LanguageModelToolResult): string | undefined`
    that returns the value of the `Result:` field, unwrapping one level of JSON
    string quoting (handles the double-encoded case).
  - `decodeBuffer(raw: string): Uint8Array` that parses `{"type":"Buffer","data":[...]}`
    or a bare number array and returns a `Uint8Array`; throws a descriptive error if
    the payload is malformed.
  - A new low-level wrapper `runPlaywrightCode(pageId, code): Promise<string | undefined>`
    that combines `invoke('run_playwright_code', ...)` + `extractRpcResult`. After U17
    lands, `runPlaywrightCode` becomes the fallback path (invoked only when CDP is
    unavailable); the CDP `Runtime.evaluate` path is inserted above it in `CdpManager`.
- Test: `src/test/extension.test.ts` — unit-test the helpers against canned VS Code
  result shapes (no LM calls needed; construct `LanguageModelTextPart` directly).

**Approach:**

- Lift the probe's `extractRpcResult` verbatim — it is the source of truth for the
  parser. Replace the probe's inline copy with an import in U13.
- `decodeBuffer` accepts both `{ type: 'Buffer', data: [...] }` and a bare number
  array (the probe handles both with a ternary).
- **Startup parse probe.** On extension activation, after the MCP server
  starts, fire one `run_playwright_code` call **only if at least one active
  `pageId` exists in the pages map** (gate on `pages.size > 0`). If no page
  is open, set `parseContract.status = 'unverified'` and log a debug message;
  the probe runs lazily on the first real Tier B/C/D/E tool call where a
  `pageId` is guaranteed. This prevents a spurious consent dialog on cold
  activation and avoids false-diverged false positives from an empty-pageId
  call. Apply `extractRpcResult` to the
  result and confirm the parsed value equals `"42"`. Store the outcome on
  `McpBridgeServer` as `parseContract: { status: 'ok' | 'diverged' | 'unverified'; details?: string }`.
  - On `'ok'`: silently continue.
  - On `'diverged'`: log a multi-line warning to the output channel with the
    raw VS Code response and the expected pattern. Tell the user explicitly
    that a VS Code update may have changed the response shape and that tools
    relying on `run_playwright_code` will return diagnostic errors until the
    extension is updated. Surface a non-modal VS Code error notification
    (`vscode.window.showErrorMessage`) with an "Open issue" button that
    deep-links to the repo's issue tracker.
  - On `'unverified'`: continue normally (no panic), log that the probe
    couldn't run (no browser page open yet).
- **Agent-visible diagnostic.** When `parseContract.status === 'diverged'`,
  every Tier B/C/D/E tool (anything that calls `runPlaywrightCode`) wraps its
  result with an explanatory prefix BEFORE returning:

  ```
  {
    isError: true,
    content: [{ type: 'text', text:
      'The Integrated Browser MCP extension cannot parse VS Code\\'s ' +
      'run_playwright_code response. This usually means a VS Code update ' +
      'changed the response format. Update the extension or report at ' +
      '<repo url>. Diagnostic: <parseContract.details>' }]
  }
  ```

  The agent sees the issue and can either tell the user, fall back to other
  tools (Tier A still works), or abort cleanly. Without this, the agent
  would receive malformed data and act on it.

**Patterns to follow:**

- `extractRpcResult` and the JPEG-decode block in
  [src/extension.ts:78-86](src/extension.ts#L78-L86) and
  [src/extension.ts:152-161](src/extension.ts#L152-L161).

**Test scenarios:**

- Happy path: `extractRpcResult` on a single `TextPart` with
  `"Result: foo\nPage Title: x"` returns `"foo"`.
- Happy path: `extractRpcResult` on a `TextPart` with double-quoted result
  `'Result: "{\\"a\\":1}"'` returns `'{"a":1}'` (one level of unwrap).
- Edge case: empty `parts` array returns `undefined`.
- Edge case: `TextPart` with no `Result:` prefix returns `undefined`.
- Happy path: `decodeBuffer('{"type":"Buffer","data":[255,216,1,2]}')` returns a
  4-byte `Uint8Array` starting with `[255, 216]`.
- Happy path: `decodeBuffer('[255,216,1,2]')` returns the same 4-byte `Uint8Array`.
- Error path: `decodeBuffer('not json')` throws an error mentioning "Buffer".

**Verification:**

- Unit tests pass.
- The probe command in `src/extension.ts` is refactored in U13 to import the
  helpers, with no behavior change.

---

- U5. **Auto-register MCP entry in Claude Code config** ✅ COMPLETE (2026-05-20)

**Goal:** On activation, check whether the Claude Code config contains our MCP entry;
if not, show a one-time VS Code notification ("Add Integrated Browser MCP to Claude
Code?") with an "Add" button. On accept, merge our entry into the config (creating
the file if absent). Track "already offered" in `extensionContext.globalState`.

**Requirements:** R3

**Dependencies:** U2 (so registration code lives in a clean place — likely
`src/install/claudeConfig.ts` plus a call from `extension.ts`)

**Files:**

- Create: `src/install/claudeConfig.ts` — exports `ensureClaudeMcpEntry(context,
  output): Promise<void>` that orchestrates the check + prompt + merge.
- Modify: `src/extension.ts` — call `ensureClaudeMcpEntry(context, output)` after
  the server starts, fire-and-forget (errors logged, never thrown).
- Test: `src/test/extension.test.ts` — add a suite for the JSON-merge logic with
  a tmp-file fixture, no actual VS Code notification.

**Approach:**

- Config path resolution (Linux/macOS):
  1. `process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR,
     'claude.json') : path.join(os.homedir(), '.claude.json')` — primary target.
  2. Fall back to `path.join(os.homedir(), '.claude', 'mcp_settings.json')` only
     if the primary path's parent directory exists but the file does not, and the
     `.claude/` directory contains a `mcp_settings.json`.
- Windows path: `path.join(process.env.APPDATA ?? '', 'Claude', 'claude.json')`.
- **Safety guards before any read:**
  - `fs.lstat` the resolved path. If it's a symlink, resolve via `fs.realpath`.
    If the realpath is outside `os.homedir()` (e.g. points to a network mount),
    log a warning to the output channel and skip auto-register entirely.
  - Wrap the read in a 5-second timeout. If it hangs (slow network drive), abort
    with a logged warning.
- **Atomic write:** assemble the merged JSON in memory; write to
  `<path>.tmp-<pid>` then `fs.renameSync(tmp, final)`. Guarantees no half-written
  state if the process dies mid-write.
- Read-modify-write with `JSON.parse` + `JSON.stringify(..., null, 2)`. Never
  overwrite — always merge `mcpServers.integratedBrowser` (use the project's
  existing key from `.mcp.json`: `integratedBrowser`, not `integrated-browser-mcp`).
- Entry shape: `{ "type": "http", "url": "http://127.0.0.1:<configuredPort>/mcp" }`.
- Skip the prompt if any existing key in `mcpServers` points at our URL pattern
  (idempotency across reinstalls + manual edits).
- Track "offered" with `context.globalState.get('claudeConfig.offered')` so the
  notification fires at most once per install. Document this lifetime as a
  Known Limitation in `docs/DEVELOPMENT.md`: *"The 'Don't ask again' choice
  resets if the extension is uninstalled and reinstalled."*
- **Locked notification copy** (use these strings verbatim):
  - Initial prompt body: *"Integrated Browser MCP isn't yet registered with
    Claude Code. Add it now?"*
  - Buttons: `[Add]` and `[Don't ask again]`
  - Success notification (after a successful write): *"Added to `~/.claude.json`.
    Restart Claude Code to pick up the change."*
  - Permission-denied error notification: *"Couldn't write to `~/.claude.json`
    (permission denied). Check the file's permissions and reload the window to
    retry."* — globalState `offered` is NOT set in this case (so the prompt
    re-appears after fixing permissions).
  - Malformed-JSON-skip warning: *"`~/.claude.json` couldn't be parsed —
    skipping auto-register. Fix the file and reload the window to retry."*
- **Fixture-based merge tests:** capture a populated `~/.claude.json` (with
  conversation history, sessions, multiple existing MCP entries — values
  anonymized) as a test fixture at `src/test/fixtures/claude.json.realistic`.
  Add a test that runs our merge against it and asserts (a) the
  `mcpServers.integratedBrowser` entry is present, (b) every other top-level
  key is byte-for-byte preserved by deep-equal, (c) the file's overall byte
  count is within the expected delta.

**Patterns to follow:**

- VS Code globalState pattern is standard; no in-repo example yet.
- Existing `.mcp.json` in repo root for the entry shape.

**Test scenarios:**

- Happy path: file does not exist → merge writes a new file containing exactly the
  expected `mcpServers.integratedBrowser` entry.
- Happy path: file exists with other `mcpServers` keys → merge preserves them all
  and adds ours.
- Happy path: file exists with our entry already present → no notification, no
  write.
- Edge case: file exists but is malformed JSON → log a warning, skip the prompt
  (do not corrupt user state).
- Edge case: globalState `claudeConfig.offered === true` → no prompt, no read.
- Error path: file is read-only / permission denied → notification surfaces the
  error; globalState is *not* set to "offered" (so the user can retry after fixing
  permissions).
- Integration: the configured port (`integratedBrowserMcp.port`) is reflected in
  the written `url`.

**Verification:**

- Unit tests for the merge logic pass against tmp-file fixtures.
- Manual: fresh VS Code session with a backed-up `~/.claude.json` shows the
  notification; clicking "Add" produces a valid, diff-able merge.

---

- U6. **`attach_visible_page` — grab control of an already-open tab** ✅ COMPLETE (2026-05-20)

**Goal:** Expose a new MCP tool `attach_visible_page` that lets an agent take
control of a browser tab the user already has open (terminal link click, debug
session, manual `Simple Browser: Show`, etc.) without the agent needing to know
the URL upfront. Under the hood the tool enumerates VS Code's tab groups for
editor-browser tabs and re-invokes `open_browser_page(url)` so VS Code emits a
real pageId we can drive with the existing LM-tool surface.

**Background:** VS Code's LM tools require *VS Code's* pageId, which is only
emitted when our extension calls `open_browser_page`. Externally-opened tabs
never produce that ID and there is no API to recover it. The earlier "passively
register external pages with a UUID" design (prior plan U6) shipped a feature
that breaks every interaction tool — see review history. This unit replaces
that design with the agent-driven tool model.

**Requirements:** R4

**Dependencies:** U2 (clean home for the tool registration)

**Files:**

- Modify: `src/tools/page.ts` — register `list_visible_pages` and
  `attach_visible_page`.
- Modify: `src/browserBridge.ts` — add `enumerateVisibleBrowserTabs(): Array<{
  url: string; viewColumn?: number; isActive: boolean }>` that scans
  `vscode.window.tabGroups` for editor-browser tabs and extracts their URLs.

**Approach:**

- **Gate experiment result (2026-05-19, discovered during U3 probe):**
  Calling `open_browser_page` with a URL already open returns **behavior (a)**:
  VS Code surfaces the existing tab's pageId without opening a duplicate. However
  the response uses a different format than the happy-path `Page ID: <uuid>`:

  ```text
  At least one similar page is already open:
  - [ff15fad8-a454-4fe8-9883-08f1b0463e38] JavaScript - Wikipedia (https://en.wikipedia.org/wiki/JavaScript) (active)
  Use an existing page or pass `forceNew: true` to open a new one.
  ```

  The existing `extractPageId` regex `/Page ID:\s*(\S+)/` misses this format.
  **Action required in this unit:** extend `extractPageId` to also match
  `/\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/` so
  `openBrowserPage()` succeeds when the page is already open. Add a test case
  for the "already open" response format to U6's test suite.
  The `tabGroups` step (step 2 of the original gate) is still needed to confirm
  the URL-enumeration path for `list_visible_pages` — that remains outstanding.
- Tool behavior (gate confirmed VS Code reuses the tab):
  - `list_visible_pages` — returns `[{ url, isActive, viewColumn }]` for every
    editor-browser tab VS Code knows about, including ones we never opened.
    Strictly read-only.
  - `attach_visible_page` — schema: `{ url?: string }`. Resolves the target URL
    (explicit argument, or active editor-browser tab if omitted), calls
    `vscode.lm.invokeTool('open_browser_page', { url, forceNew: false })`,
    extracts the pageId from the updated `extractPageId` (handles both formats),
    stores it in the session `pages` map, returns the pageId. The agent then
    drives the page with the existing tool surface (click, type, screenshot)
    unchanged.
- No duplicate tab risk — VS Code's own dedup logic handles this (confirmed).

**Patterns to follow:**

- Existing `open_browser_page` registration in `src/tools/page.ts` (post-U2).
- `extractPageId` in [src/browserBridge.ts:40-48](src/browserBridge.ts#L40-L48)
  for parsing the pageId out of the LM tool result.

**Test scenarios:**

- Happy path: `list_visible_pages` with one externally-opened tab returns one
  entry with the expected URL and `isActive: true`.
- Happy path: `attach_visible_page` with no arguments and one visible tab
  returns a real pageId; subsequent `read_page` on that pageId succeeds.
- Happy path: `attach_visible_page({ url: 'http://localhost:8080' })` when
  that URL is open returns its pageId; when not open, opens it fresh.
- Edge case: no editor-browser tabs visible and no URL passed → tool returns
  an error pointing at `open_browser_page` directly.
- Edge case: multiple tabs match the URL → tool attaches to the first match
  (document the ordering).
- Integration (manual): user clicks a terminal link to `http://localhost:8080`,
  agent calls `attach_visible_page()`, then `read_page` returns the correct
  content.

**Verification:**

- Gate experiment results are documented in `docs/DEVELOPMENT.md`.
- Manual integration test passes against a live `http://localhost:8080` dev
  server tab opened externally.

---

- U7. **Tier A tools — hover_element, drag_element, handle_dialog** ✅ COMPLETE (2026-05-20)

**Goal:** Wire the three remaining VS Code LM browser tools through MCP. Schemas
must be read from `vscode.lm.tools` at development time and mirrored verbatim
because they differ from `click_element`.

**Requirements:** R5

**Dependencies:** U2; U4 is optional — Tier A doesn't call
`run_playwright_code`, so `extractRpcResult`/`decodeBuffer` aren't needed.
The only reason to await U4 is if `src/tools/_schemas.ts` (lifted from U1) ends
up holding shared fragments Tier A reuses.

**Files:**

- Modify: `src/browserBridge.ts` — add `hoverElement`, `dragElement`, `handleDialog`
  wrapper functions. Update `BROWSER_TOOLS` constants.
- Modify: `src/tools/interaction.ts` — register the three new tools, importing
  schema fragments from `src/tools/_schemas.ts`.
- Test: `src/test/extension.test.ts` — assert registration shape only.

**Approach:**

- Before writing the registrations, run the `integratedBrowserMcp.listTools`
  command in the dev host and capture the `inputSchema` for each of the three
  tools from `vscode.lm.tools`. Mirror the schemas in zod.
- Use `z.object({...}).passthrough()` (not strict) so that if VS Code adds
  optional fields to the LM tool schema in a future release, our wrapper
  forwards them instead of rejecting or stripping. Add a manual TC to
  `docs/DEVELOPMENT.md` that periodically re-runs `listTools` and diffs
  against a captured snapshot.
- `handle_dialog` likely takes `{ pageId, action: 'accept' | 'dismiss', text?:
  string }` — confirm before implementing.
  **Confirmed (2026-05-28):** VS Code uses `acceptModal: boolean`, not `action`.
  Bridge translates `action === 'accept'` → `acceptModal`. MCP schema keeps `action`.
- `drag_element` likely takes source/target element references — confirm shape.
  **Confirmed (2026-05-28):** VS Code uses `fromElement`/`fromRef`/`fromSelector`/
  `toElement`/`toRef`/`toSelector`. Bridge translates from `source*`/`target*` MCP
  names to `from*`/`to*` VS Code names.

**Patterns to follow:**

- Existing `click_element` registration in [src/mcpServer.ts:133-149](src/mcpServer.ts#L133-L149).
- Existing `clickElement` wrapper in [src/browserBridge.ts:88-94](src/browserBridge.ts#L88-L94).

**Test scenarios:**

- Happy path: each new tool appears in the registered-tool list with the expected
  name and description.
- Test expectation: behavioral testing against real browser is manual — add
  TC9 (hover), TC10 (drag), TC11 (dialog) to `docs/DEVELOPMENT.md`.

**Verification:**

- `pnpm test` passes.
- Manual TC9–TC11 pass against the dev host.

---

- U8. **Tier B tools — eval_js, get_dom, scroll, emulate, get_url** ✅ COMPLETE (2026-05-20)

**Goal:** Add five `run_playwright_code`-backed tools (four), plus one trivial
registry getter (`get_url`). All share the `extractRpcResult` parse path.

**Requirements:** R6

**Dependencies:** U4 (helpers required)

**Files:**

- Modify: `src/browserBridge.ts` — add `evalJs`, `getDom`, `scroll`, `emulate`
  wrappers. Each builds a `code` string, calls `runPlaywrightCode(pageId, code)`,
  and returns the extracted result.
- Modify: `src/tools/content.ts` — register `eval_js`, `get_dom`.
- Modify: `src/tools/interaction.ts` — register `scroll`.
- Modify: `src/tools/visual.ts` — register `emulate`.
- Modify: `src/tools/page.ts` — register `get_url` (uses `ctx.pages.get(pageId)`
  directly, no LM call).
- Test: `src/test/extension.test.ts` — assert registration and basic schema
  shapes for all five.

**Approach:**

- **Code-string assembly rule (applies to all Tier B/C/D/E tools that build
  `run_playwright_code` payloads):** never interpolate raw values directly into
  the code template literal. Pass values through `JSON.stringify(...)` so
  backticks, `${...}` sequences, quotes, and special characters cannot break
  the outer template. The only exception is the `expression` body of `eval_js`,
  which is wrapped via `page.evaluate(new Function('return ' + expr))` so the
  agent's expression is parsed as a top-level expression in page context, not
  spliced into our code string. zod schemas validate types but do not sanitize
  string contents — escaping is the code-string assembly step's job.
- `eval_js` schema: `{ pageId, expression: string }`. Tool description copy
  (exact text for the registration's `description`): *"Runs arbitrary
  JavaScript in the open page — same trust model as the DevTools console.
  Don't pass untrusted input."* **Note:** `eval_js` safety depends entirely on
  MCP server auth being present. Until the session-token work (see Open Questions
  — DNS rebinding risk) ships, document that `eval_js` must not be used on pages
  handling credentials when the MCP server is reachable by untrusted local processes. Code passed to `run_playwright_code`:
  `const fn = new Function('return (' + ${JSON.stringify(expression)} + ');');
   return JSON.stringify(await page.evaluate(fn));`. Result is unwrapped via
  `extractRpcResult` and returned as `{ type: 'text', text: result }`. The
  README's tool list mirrors the same warning verbatim.
- `get_dom` schema: `{ pageId, selector?: string }`. Code uses `JSON.stringify`
  on `selector` before interpolation: `return await page.evaluate(sel => (sel ?
  document.querySelector(sel)?.outerHTML : document.documentElement.outerHTML),
  ${JSON.stringify(selector)});`.
- `scroll` schema: `{ pageId, deltaX?: number, deltaY?: number, x?: number,
  y?: number }`. zod numeric coercion guarantees numbers, but interpolate via
  `Number(...)` or template-as-number for defense in depth. Add `.refine()` to
  enforce that at least one of `deltaX`, `deltaY`, `x`, or `y` is provided;
  message: `"scroll requires deltaX/deltaY or x/y"`. If absolute `x/y`
  provided: `window.scrollTo(x, y)`. Otherwise: `window.scrollBy(deltaX ?? 0,
  deltaY ?? 0)`.
- `emulate` schema: `{ pageId, width: number, height: number }` (zod
  `.int().positive().max(8192)` to cap viewport size). Code: `await
  page.setViewportSize({ width: ${Number(width)}, height: ${Number(height)} });`.
- **Visible-panel gate experiment (~5 minutes, do before shipping `emulate`):**
  The probe in `src/extension.ts` confirmed `setViewportSize` doesn't error
  and that `page.viewportSize()` reflects the new value, but never checked
  whether the **visible** browser panel matches. Run this once:
  1. Open the Integrated Browser and dock it at ~900×700 visually.
  2. Call `setViewportSize(1024, 600)` via `eval_js` or a one-off probe.
  3. Observe the panel. Three possible outcomes:
     - Panel visibly resizes to ~1024×600 → `emulate` is honest, keep as
       drafted.
     - Panel doesn't visibly change but the page inside re-lays-out for
       1024×600 (responsive CSS / media queries fire) → case (b);
       `emulate` is still useful for forcing screenshot dimensions but
       document `"affects screenshot output and CSS layout, not the
       visible panel size"` in the tool description.
     - Nothing visible changes AND the page renders at panel-size despite
       `page.viewportSize()` returning the new value → headless mismatch.
       Drop `emulate` from U8 entirely; U10 (`screenshot_slice`) skips its
       optional width/height parameters and uses `page.innerWidth`/
       `page.innerHeight` directly.
  4. Record the outcome in `docs/DEVELOPMENT.md`.
- `get_url` schema: `{ pageId }`. Returns the stored URL or "(unknown url)" with
  the same "stale-after-side-effect-navigation" caveat already documented in
  `docs/DEVELOPMENT.md`.

**Patterns to follow:**

- Probe's screenshot + dimensions blocks in
  [src/extension.ts:124-142](src/extension.ts#L124-L142) for the code-string shape.

**Test scenarios:**

- Happy path: `eval_js` registration accepts a `{ pageId, expression }` input.
- Happy path: `scroll` registration accepts either `{ deltaX, deltaY }` or
  `{ x, y }`.
- Edge case: `scroll` with neither delta nor absolute set → error result with a
  clear message (not silently a no-op).
- Edge case: `emulate` with negative width/height → zod rejects before LM call.
- Happy path: `get_url` for a known pageId returns the URL.
- Edge case: `get_url` for an unknown pageId returns "(unknown url)" or an error
  (decide based on consistency with `close_page`'s lenient behavior).
- Test expectation for live behavior: manual TC12–TC15 in `docs/DEVELOPMENT.md`.

**Verification:**

- `pnpm test` passes.
- Manual: run `eval_js` to get `document.title` on Wikipedia; assert correct title
  returned. Run `emulate` then `screenshot_page` and observe the changed viewport.

---

- U9. **Tier C — screenshot_page additions (fullPage, waitMs)** ✅ COMPLETE (2026-05-21)

**Goal:** Extend `screenshot_page` with two optional parameters: `fullPage`
(boolean, default false) and `waitMs` (number, default 0). When either is set,
the call routes through `run_playwright_code` instead of the native LM tool so we
can pass options Playwright supports but the LM tool does not expose.

**Requirements:** R7

**Dependencies:** U4 (helpers), U8 (touches the same Tier B mechanics)

**Files:**

- Modify: `src/browserBridge.ts` — extend `screenshotPage` with optional
  `fullPage`/`waitMs`; branch internally on whether to use the native LM tool or
  `run_playwright_code`. When using `run_playwright_code`, decode the Buffer via
  `decodeBuffer` and return as `{ type: 'image', data: <base64>, mimeType:
  'image/jpeg' }`.
- Modify: `src/tools/visual.ts` — extend `screenshot_page` registration's
  `inputSchema` with the two new optional fields.
- Test: `src/test/extension.test.ts` — registration assertions for the new fields.

**Approach:**

- Branching rule: if `fullPage` or `waitMs` is set, use `run_playwright_code`;
  otherwise, keep using the existing LM `screenshot_page` tool (preserves the
  existing `ref`/`selector` element-cropping codepath that the LM tool already
  supports).
- The `run_playwright_code` code string (note the `Number()` / `Boolean()`
  coercions follow the code-string assembly rule from U8 — never raw
  interpolation):

  ```js
  if (${Number(waitMs) || 0} > 0) { await page.waitForTimeout(${Number(waitMs) || 0}); }
  return await page.screenshot({ type: 'jpeg', quality: 80, fullPage: ${Boolean(fullPage)} });
  ```

- zod schema caps `waitMs` at 30000 (30s) to prevent DoS via indefinite hold.

**Patterns to follow:**

- Probe's screenshot+decode block in
  [src/extension.ts:144-161](src/extension.ts#L144-L161).

**Test scenarios:**

- Happy path: registration includes the two new fields with optional defaults.
- Edge case: `fullPage` and `waitMs` both omitted → behavior is identical to the
  pre-U9 `screenshot_page` (regression check; same content shape, no extra LM
  calls).
- Edge case: `waitMs > 0` only, `fullPage` omitted → uses `run_playwright_code`
  path; result is a single image content part.
- Error path: `waitMs` negative → zod rejects.

**Verification:**

- `pnpm test` passes.
- Manual: full-page screenshot of a tall page (Wikipedia article) returns one
  image taller than viewport.

---

- U10. **Tier C — screenshot_slice (new tool)** ✅ COMPLETE (2026-05-21)

**Goal:** Add `screenshot_slice` that returns a single viewport-height slice of
the page at a given slice index. Supports Pythonic negative indexing
(`slice = -1` is the last slice). Always restores scroll position via
`try/finally`. Optionally applies `emulate` before slicing.

**Requirements:** R7

**Dependencies:** U4, U8, U9 (consistent with the other visual tools)

**Files:**

- Modify: `src/browserBridge.ts` — add `screenshotSlice(pageId, slice, width?,
  height?)` wrapper.
- Modify: `src/tools/visual.ts` — register `screenshot_slice`.
- Test: `src/test/extension.test.ts` — registration shape + slice-index math
  (unit-testable in isolation: extract the index normalization to a pure helper
  and test that).

**Approach:**

- `inputSchema`: `{ pageId, slice: integer, width?: integer, height?: integer }`.
- Flow:
  1. If `width`/`height` provided: call `runPlaywrightCode(pageId,
     'await page.setViewportSize({...});')` first.
  2. Single `run_playwright_code` call combining: read viewport size, read
     `scrollHeight`, compute `totalSlices`, normalize `slice` (`((slice %
     totalSlices) + totalSlices) % totalSlices`), save `prevY`, scroll to
     `targetY = normalizedSlice * vh`, `waitForTimeout(200)`, capture screenshot,
     restore `prevY` in a `try/finally`, return JSON with `image` (as buffer) +
     metadata `{ totalSlices, scrollHeight, viewportHeight, slice: normalizedSlice }`.
- Response: one MCP `image` content part (decoded JPEG) + one `text` content
  part with the metadata JSON. The text-first ordering matches the existing
  conventions in `read_page` / `screenshot_page`.
- The combined `run_playwright_code` block returns
  `JSON.stringify({ image: <buffer>, meta: {...} })` — `extractRpcResult` plus
  one JSON unwrap parses both at once.

**Patterns to follow:**

- Probe's slice block in [src/extension.ts:164-191](src/extension.ts#L164-L191).

**Test scenarios:**

- Happy path (pure helper): `normalizeSlice(0, 5)` returns 0; `normalizeSlice(4,
  5)` returns 4; `normalizeSlice(-1, 5)` returns 4; `normalizeSlice(-5, 5)`
  returns 0.
- Edge case: `normalizeSlice(7, 5)` (positive overshoot) — decide if this clamps
  or wraps. Recommendation: clamp via `Math.max(0, Math.min(slice, totalSlices -
  1))` for positive overshoot, wrap for negative. Document the choice.
- Edge case: `totalSlices === 1` → any slice index returns 0 and produces the
  full-viewport screenshot.
- Error path: invoking the slice generates an exception mid-screenshot → the
  scroll restore in the finally block still fires. Validated via an injected
  failure in a unit-level test for the helper if practical; otherwise manual.
- Integration: capture slice 0 and slice -1 of Wikipedia; both produce valid
  JPEGs; `scrollY` afterwards equals `scrollY` before the call.

**Verification:**

- `pnpm test` passes.
- Manual: agent can iterate `slice = 0, 1, 2, ...` until `totalSlices` is hit
  and reconstruct a full-page view.

---

- U11. **Tier D — markdown extraction tool** ✅ COMPLETE (2026-05-21)

**Goal:** Add a `markdown` tool that returns a clean markdown rendering of the
page (or a selector-scoped subtree). Implementation is ~80 lines of in-page JS
passed to `run_playwright_code`. No npm dependency.

**Requirements:** R8

**Dependencies:** U4

**Files:**

- Modify: `src/browserBridge.ts` — add `markdown(pageId, selector?)` wrapper.
- Modify: `src/tools/content.ts` — register `markdown`.
- Test: `src/test/extension.test.ts` — registration shape only (in-page JS is
  exercised manually since it depends on a live DOM).

**Approach:**

- `inputSchema`: `{ pageId, selector?: string }`.
- The in-page JS: a recursive DOM walker. Scope to `document.querySelector(selector)`
  if provided; else `document.querySelector('main') ?? document.body`. Handle:
  - `H1`–`H6` → `#`–`######` + text + double newline.
  - `A` → `[text](href)`.
  - `CODE` (inline) → `` `text` ``.
  - `PRE` → fenced ```` ``` ```` block. Use first-child `CODE`'s class for the
    language tag when present (e.g. `class="language-ts"` → ` ```ts `).
  - `UL > LI` → `- text\n`. `OL > LI` → `1. text\n` (always `1.` — markdown
    auto-numbers).
  - `BLOCKQUOTE` → `> text\n`.
  - `BR` → newline.
  - `P` → text + double newline.
  - `IMG` → `![alt](src)`.
  - Everything else: recurse into children, accumulate text.
- The walker's return value is the markdown string. `run_playwright_code`
  returns it; `extractRpcResult` unwraps; the tool returns a single `text`
  content part.

**Test scenarios:**

- Happy path: registration accepts `{ pageId }` and `{ pageId, selector }`.
- Edge case: `selector` does not match → tool returns empty string with a clear
  text message ("Selector did not match any element").
- Integration (manual): markdown of Wikipedia's JavaScript article includes
  expected headings (`# JavaScript`), preserves at least one fenced code block,
  and contains at least one link in `[text](url)` form.
- Integration (manual): markdown with `selector: 'main'` excludes navigation
  and footer elements.

**Verification:**

- `pnpm test` passes.
- Manual: render Wikipedia and confirm structure is recognizable markdown.

---

- U12. **Tier E — console capture (get_console, clear_console, auto-inject)** ✅ COMPLETE (2026-05-21)

**Goal:** Inject a console-capture script into every page on `open_browser_page`
that buffers console events to `window.__mcpConsole`. Expose `get_console` and
`clear_console` MCP tools to retrieve and clear the buffer. The injection is
best-effort and only captures output after injection — document this limitation
in the tool descriptions.

**Requirements:** R9

**Dependencies:** U2 (clean place for the diagnostic registrar), U4 (helpers)

**Files:**

- Modify: `src/browserBridge.ts` — add `injectConsoleCapture(pageId)`,
  `getConsole(pageId)`, `clearConsole(pageId)` wrappers.
- Modify: `src/tools/page.ts` — `open_browser_page` handler calls
  `injectConsoleCapture(pageId)` after the page opens, fire-and-forget (log
  failures, do not fail the open).
- Modify: `src/tools/diagnostic.ts` — register `get_console` and `clear_console`.
- Test: `src/test/extension.test.ts` — registration + the auto-inject hook is
  triggered after `open_browser_page` succeeds.

**SPA support is non-negotiable.** Most users debug single-page apps (React,
Vue, Next, Svelte) where interesting console output fires during client-side
route changes — not full page loads. The mechanism below is decided by a
spike; both mechanisms must work across SPA navigations.

**Mechanism selection spike — completed (result: Mechanism A not viable):**
Playwright listeners registered via `run_playwright_code` do NOT persist across
subsequent calls — each call gets a fresh page context. Mechanism B (in-page
injection) was taken.

**⚠ Correction (2026-05-28 — confirmed by manual tool tour):** Mechanism B is
also non-functional on the `run_playwright_code` fallback path. `window.__mcpConsole`
set via `page.evaluate()` in one `run_playwright_code` call is NOT visible to a
subsequent call — the JS heap does not persist across separate LM-tool invocations
(confirmed: `get_console` always returns `[]` without CDP). **`get_console` /
`clear_console` only work correctly when CDP (U17) is active.** The invokeTool
fallback path should document this limitation explicitly in the tool description.

- **Mechanism A (listener does not persist — not viable):** ~~register
  `page.on('console')` once on `open_browser_page`~~.
- **If the listener doesn't persist (Mechanism B — fallback):** use in-page
  injection PLUS a re-injection trigger. Hook `page.on('framenavigated')`
  via a separate persistent mechanism (if A is impossible, B probably is too —
  in which case poll `document.readyState` on every `get_console` call and
  re-inject if `window.__mcpConsole` is missing). Document the polling
  trade-off explicitly.

**Mechanism B injection code (passed to `run_playwright_code`, fallback only):**

  ```js
  await page.evaluate(() => {
    if (window.__mcpConsole) return;
    window.__mcpConsole = [];
    for (const level of ['log','warn','error','info','debug']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        try { window.__mcpConsole.push({ level, ts: Date.now(),
          args: args.map(a => { try { return String(a); } catch { return '[unstringifiable]'; } }) }); } catch {}
        orig(...args);
      };
    }
  });
  ```

  Every `get_console` call first re-injects (idempotent — the
  `if (window.__mcpConsole) return` guard skips if already present) so SPA
  navigations that wiped `window` get re-hooked transparently.

- `get_console` returns the buffer as a JSON-stringified array in a `text`
  content part. Optional `inputSchema` field `levels?: string[]` filters by
  level (e.g. `['error']`).
- `clear_console` resets the buffer (Mechanism A: clears the Playwright-side
  array; Mechanism B: `window.__mcpConsole = []`).
- **Out of scope (documented in tool description):** Service Workers, Web
  Workers, and cross-origin iframes. These run in separate execution contexts
  that neither mechanism reaches. If users need them, that's a follow-up.
- **⚠ Exfiltration risk (required in tool description and Known Limitations):**
  `get_console` buffers all `console.*` output from the page and returns it to any
  MCP session that can reach the server. Pages may log auth tokens, JWTs, PII, or
  secrets to the console. Tool description must include: *"Console capture buffers
  all `console.*` output including potentially sensitive values (tokens, PII). Do
  not use on pages handling credentials you haven't verified."*

**Test scenarios:**

- Happy path: `get_console` registration accepts `{ pageId }` and `{ pageId,
  levels }`.
- Happy path (manual): open page → `console.log('hello')` from the page's own
  script → `get_console` returns an entry with `level: 'log'` and `args:
  ['hello']`.
- Edge case: SPA navigation that wipes `window` properties → **implemented
  behavior (Mechanism B, spike result: Playwright listener does not persist across
  `run_playwright_code` calls)**: `get_console` re-injects on every call (the
  `if (window.__mcpConsole) return` guard is idempotent). SPA navigations that
  wipe `window` are transparently re-hooked on the next `get_console` call.
  Document in tool description: "Console events fired between a navigation and
  the next `get_console` call are not captured." The earlier "do not re-inject"
  edge case note was aspirational; Mechanism B as shipped IS the re-inject approach.
- Edge case: `clear_console` empties the buffer; next `get_console` returns `[]`.
- Error path: injection fails (e.g. CSP blocks inline scripts) → `open_browser_page`
  still returns a valid pageId; the failure is logged but not surfaced. Document
  the limitation in the tool description.
- Integration: `open_browser_page` → trigger a page action that emits an error
  → `get_console` filtered to `levels: ['error']` returns just the error entry.

**Verification:**

- `pnpm test` passes.
- Manual: a page that calls `console.error('boom')` is observed via `get_console`.

---

- U16. **CI workflow + integration tests for new tools** ✅ COMPLETE (2026-05-21)

**Goal:** Stand up a GitHub Actions workflow that runs the test suite on PRs
and pushes. Add one happy-path integration test per Tier so the parse-and-decode
chain through `run_playwright_code` is verified end-to-end at CI time, not just
in local manual runs. Closes the regression gap created when U13 deletes the
probe command.

**Requirements:** Improves on R11 (project conventions); makes the plan's test
discipline actually enforceable.

**Dependencies:** U2 (clean test home); per-Tier tests block on the relevant
tool unit (U7 for Tier A, U8 for Tier B, etc.).

**Files:**

- Create: `.github/workflows/test.yml` — runs on `pull_request` and `push` to
  `main`. Linux runner. Steps: `pnpm install`, `pnpm run lint`, `pnpm run
  compile`, `xvfb-run -a pnpm test`.
- Create: `src/test/integration/tier-b.test.ts` — calls one Tier B tool
  (e.g. `eval_js` returning `1 + 1`) via MCP and asserts the response shape.
- Create: `src/test/integration/tier-c.test.ts` — calls `screenshot_page`
  (existing) plus `screenshot_slice` (new) and asserts JPEG byte signature.
- Create: `src/test/integration/tier-d.test.ts` — calls `markdown` on a
  fixture page and asserts a recognizable markdown header in the output.
- Create: `src/test/integration/tier-e.test.ts` — calls `get_console` after
  triggering a `console.log` and asserts the entry appears.
- Modify: `src/test/integration/tier-a.test.ts` (new) — manual or skipped
  depending on whether `hover_element` can be invoked without a real cursor.
- Modify: `docs/DEVELOPMENT.md` — add a "CI test environment" section
  documenting the xvfb setup and how to debug failures locally.

**Approach:**

- **Pre-flight spike — complete (2026-05-19).** `.github/workflows/test.yml`
  ships; 17 unit tests pass in CI under `xvfb-run -a pnpm test`.
  `src/test/integration/lm-tool-availability.test.ts` verifies that
  `open_browser_page` appears in `vscode.lm.tools` in the headless extension
  host (18th test, green). Setup: `workbench.browser.enableChatTools: true`
  pre-configured in `src/test/workspace/.vscode/settings.json`; test runner
  pointed at that workspace via `.vscode-test.mjs` `workspaceFolder` option.
  **Integration tests are viable in CI.** Outstanding: whether `invokeTool` can
  open a real browser tab without a workbench renderer — to be answered by the
  Phase 4 per-Tier test runs.
- **Test setup hook** (shared across per-Tier integration tests): `suiteSetup`
  waits 3 s for VS Code to finish registering tools; no programmatic setting
  write needed (pre-set in workspace). `vscode.commands.executeCommand` to open
  the browser panel may still be needed for tests that call `invokeTool` — add
  if the Phase 4 spike shows it's required.
- **Test shape:** each integration test instantiates an `McpBridgeServer` on
  port 3199 (matches existing tests), connects as an HTTP MCP client (the
  existing test file already does this), calls one tool, asserts the
  response. Same harness pattern as today.

**Patterns to follow:**

- Existing tests in [src/test/extension.test.ts](src/test/extension.test.ts)
  already use the MCP-client-as-tester pattern.
- VS Code's own template repo for xvfb-driven Linux CI:
  <https://github.com/microsoft/vscode-extension-samples> (any sample with
  `.github/workflows/main.yml` shows the standard pattern).

**Test scenarios:**

- Happy path (workflow itself): the CI job runs `pnpm test` headlessly on a
  push to `main`; passes; exits zero.
- Happy path (Tier B): `eval_js({ expression: '1 + 1' })` returns a text
  content part with value `"2"`.
- Happy path (Tier C): `screenshot_page({ pageId })` returns one image
  content part whose decoded bytes start with `[0xFF, 0xD8]` (JPEG).
- Happy path (Tier D): `markdown({ pageId })` on a fixture page with an
  `<h1>Hello</h1>` returns text containing `# Hello`.
- Happy path (Tier E): after `eval_js({ expression: 'console.log("boom")' })`,
  `get_console({ pageId })` returns at least one entry with text `"boom"`.
- Edge case: spike fails → CI workflow keeps the unit-test job but skips
  the integration-test job; release checklist in `docs/DEVELOPMENT.md`
  documents the manual fallback.

**Verification:**

- CI workflow runs green on a representative PR.
- Each Tier's integration test passes locally with `xvfb-run pnpm test`.
- A deliberate break in `extractRpcResult` causes at least one integration
  test to fail (smoke test for the regression-net's correctness).

**Execution note:** This unit is most valuable if it lands EARLY — the
scaffolding piece (workflow YAML + spike) is independent of every tool unit
and can ship in Phase 0 alongside the consent spike. The per-Tier integration
tests then accrue as each Tier's tool unit lands.

---

- U17. **Hybrid CDP layer — replace `run_playwright_code` with `Runtime.evaluate`** ✅ COMPLETE (2026-05-28)

**Goal:** Eliminate the per-unique-script consent dialogs that fire on every Tier B/C/D/E
tool call. Replace all `runPlaywrightCode()` call sites in `browserBridge.ts` with a CDP
`Runtime.evaluate` call via VS Code's proposed `browser` API, while keeping all Tier A tools
(`open_browser_page`, `read_page`, `navigate_page`, `click_element`, `type_in_page`,
`hover_element`, `drag_element`, `handle_dialog`, standard `screenshot_page`) as-is via
`vscode.lm.invokeTool`.

**Requirements:** R2 (the workaround for per-call consent), R11

**Dependencies:** U4 (establishes `runPlaywrightCode` as the single call site to replace),
all Tier B/C/D/E units (U8–U12) landed; U17 is a drop-in swap beneath them.

**Gate results (2026-05-27):**

- **FAILED — `onDidStartDebugSession` (2026-05-26):** Does not fire for the Integrated
  Browser. The Integrated Browser is not a debug adapter target; `requestCDPProxy` is
  inaccessible. Sessions captured: 0.
- **FAILED — `--remote-debugging-port` via `argv.json`:** Two problems: (1) VS Code on
  Windows reads `C:\Users\<user>\.vscode\argv.json`, not WSL's `~/.vscode/argv.json`.
  (2) `remote-debugging-port` is not in VS Code's supported argv.json key whitelist —
  the key is silently ignored even when written to the correct file. Port 9222 never
  opens.
- **PASSED — VS Code proposed `browser` API (2026-05-27):** `"enabledApiProposals":
  ["browser"]` in `package.json` + `"enable-proposed-api": ["Nagell.vscode-integrated-browser-mcp"]`
  in `C:\Users\<user>\.vscode\argv.json` (Windows-side file; written once, VS Code
  restarted once) gives access to:
  - `vscode.window.browserTabs` — list of open Integrated Browser tabs ✅
  - `vscode.window.onDidOpenBrowserTab` — fires when `open_browser_page` opens a tab ✅
  - `BrowserTab.startCDPSession()` — returns a `BrowserCDPSession` object ✅
  - `Target.getTargets` + `Target.attachToTarget` → `pageSessionId` ✅
  - `Runtime.evaluate { expression: "1+1", returnByValue: true }` → `{ value: 2 }` ✅
  - `Runtime.evaluate { expression: "document.title" }` → `"Example Domain"` ✅

**Key implementation facts (from gate experiment):**

- `BrowserCDPSession` shape: `{ sendMessage(obj): Promise<void>, onDidReceiveMessage(cb),
  onDidClose(cb), close() }`. Messages are **objects** (not strings) in both directions.
  No `ws` npm package needed.
- Bootstrap required after `startCDPSession()`: send `Target.getTargets` with
  `sessionId: null` (root level) → find the `page` target → send `Target.attachToTarget
  { targetId, flatten: true }` with `sessionId: null` → save `attachResult.sessionId` as
  `pageSessionId` → use `pageSessionId` in all subsequent page-scoped commands.
- Tab correlation: after `open_browser_page(url)` returns a `pageId`, scan
  `vscode.window.browserTabs` for the tab whose `.url` matches (normalize trailing slash).
  Map `pageId → BrowserTab` in `CdpManager`.
- The Windows-side `argv.json` path from WSL: `/mnt/c/Users/dawid/.vscode/argv.json`.
  The `enableCdp` command must write to the Windows path (use `os.homedir()` from
  extension host which resolves to WSL home — same WSL/Windows boundary issue as
  `ensureClaudeMcpEntry`; hard-code Windows path detection or document manual step).

**Files:**

- Create: `src/cdp/cdpSession.ts` — exports `CdpSession` class:
  - constructor takes a `BrowserCDPSession`-shaped object (typed via local interface,
    not from `vscode.d.ts` — proposed API types not in stable typings).
  - `bootstrap(): Promise<void>` — `Target.getTargets(sessionId:null)` → find page target
    → `Target.attachToTarget({ targetId, flatten:true }, sessionId:null)` → save
    `pageSessionId`. Throws if no page target found.
  - `evaluate(expression: string): Promise<string | undefined>` — wraps expression in
    `(async function(){ ${expression} })()`, sends `Runtime.evaluate` with
    `{ awaitPromise:true, returnByValue:true }` using `pageSessionId`. Returns
    `String(result.value)` or `result.description` on undefined.
  - `send(method: string, params?: Record<string,unknown>, sessionId?: string|null): Promise<unknown>` —
    request-response correlation via incrementing `id` + `pending` Map with 30 s timeout.
    Routes with `pageSessionId` by default; pass `null` for root-level commands.
  - `dispose(): void` — calls `session.close()`, rejects pending requests, clears state.
- Create: `src/cdp/cdpManager.ts` — exports `CdpManager`:
  - `trackTab(pageId: string, tab: BrowserTab): void` — stores `pageId → BrowserTab`.
    Called from `openBrowserPage()` after URL match.
  - `removeTab(pageId: string): void` — disposes session + removes mapping. Called from
    `closePage()`.
  - `ensureSession(pageId: string): Promise<CdpSession>` — returns cached session or
    creates one: call `tab.startCDPSession()`, wrap in `CdpSession`, call `bootstrap()`,
    cache and return. Falls back by throwing (caller catches and uses `invokeTool`).
  - `dispose(): void` — disposes all sessions.
- Modify: `src/browserBridge.ts`:
  - Add module-level `let cdpManager: CdpManager | undefined` + `setCdpManager()` setter.
  - `openBrowserPage()` — after extracting `pageId`, scan `vscode.window.browserTabs` for
    URL match and call `cdpManager.trackTab(pageId, tab)` if found.
  - Each Tier B/C/D/E function gets a CDP-first path with `invokeTool` fallback. The CDP
    path uses browser-native JS (no `page.*` wrappers). See code string rewrites below.
  - `closePage()` — call `cdpManager.removeTab(pageId)` after `invoke`.
- Modify: `src/extension.ts`:
  - At activation: check `(vscode.window as any).browserTabs !== undefined` to detect
    proposed API. If present: create `CdpManager`, call `bridge.setCdpManager(manager)`,
    subscribe `vscode.window.onDidOpenBrowserTab` (adopt tabs opened before activation).
  - Add `integratedBrowserMcp.enableCdp` command — writes
    `"enable-proposed-api": ["Nagell.vscode-integrated-browser-mcp"]` to the Windows-side
    `argv.json` (path: `/mnt/c/Users/<winuser>/.vscode/argv.json`) with RMW + conflict
    guard + user confirmation. Shows `"Restart VS Code to enable dialog-free browser tools"`.
  - Remove `integratedBrowserMcp.probeBrowserApi` debug command after U17 ships.

**Code string rewrites (Playwright → browser JS):**

- `evalJs`: `(async()=>{ return JSON.stringify(await (async()=>(${expression}))()); })()`
  (awaitPromise:true, returnByValue:true) → result.value is the JSON string.
- `getDom`: `(function(){ const s=${JSON.stringify(sel??null)}; return s ?
  document.querySelector(s)?.outerHTML??'' : document.documentElement.outerHTML; })()`
- `scroll`: already browser JS — pass unchanged.
- `markdown`: remove outer `page.evaluate((sel)=>{...}, selector)` wrapper →
  self-contained IIFE with selector inlined via `JSON.stringify`.
- `getConsole`: split into two `evaluate()` calls — (1) inject `CONSOLE_INJECT` as IIFE
  (strip `await page.evaluate(() => {...})` wrapper), (2) read buffer.
- `clearConsole` / `injectConsoleCapture`: strip `await page.evaluate(() => {...})` wrapper.
- `emulate`: use `send('Emulation.setDeviceMetricsOverride', { width, height, ... })` via
  `CdpSession.send()` instead of `page.setViewportSize`.
- `screenshotPage` (fullPage path): use `send('Page.captureScreenshot', { format:'jpeg',
  quality:80 })` → decode base64 `data` field.
- `screenshotSlice`: `Page.captureScreenshot` via `send()` + scroll via `evaluate()`.
  Scroll-restore issued as a separate `evaluate()` from TypeScript.
- `closePage`: stays on `invokeTool` — `page.close()` has no `Runtime.evaluate` equivalent
  in VS Code WebViews. One dialog per VS Code session is acceptable.

**Approach:**

- **Fallback strategy:** if `cdpManager` is undefined (proposed API not available) or
  `ensureSession()` throws, `runPlaywrightCode` falls back to `invokeTool` silently.
  On first fallback, log: `[cdp] CDP unavailable — falling back to invokeTool (consent
  dialogs will appear). Run "Integrated Browser MCP: Enable CDP" to set up.`
- **`parseContractGuard`:** remove from CDP evaluate path; keep in `invokeTool` fallback
  branch (guard protects `extractRpcResult` parsing, which only runs in the fallback).
- **No `ws` package** — transport is `BrowserCDPSession.sendMessage(object)`, no WebSocket.
- **`parseContractGuard` decision:** After U17 ships, `parseContractGuard` only fires when
  CDP is unavailable and the fallback `invokeTool` path is used. U17 should explicitly
  decide: remove `parseContractGuard` from the Tier B/C/D/E CDP call sites and retain it
  only in the fallback branch, or keep it on all paths. Recommended: remove from CDP path
  (guard protects `extractRpcResult` parsing which only runs in the fallback), retain in
  fallback `invokeTool` branch to preserve the diverged-format detection for that path.
- **Code string pass-through**: CDP `Runtime.evaluate` accepts arbitrary JS. The `code`
  strings built by `evalJs`, `getDom`, `markdown`, etc. pass unchanged — they are already
  valid JS. Playwright-specific APIs (`page.*`) are NOT available in the CDP context;
  all existing `runPlaywrightCode` code strings must be audited and rewritten to use
  plain browser JS (`window.scrollBy`, `document.querySelector`, etc.). See sub-tasks below.
- **Playwright-to-browser-JS migration** (required before U17 can ship):
  - `closePage`: stays on the `invokeTool` path — `page.close()` is a Playwright
    server-side API with no `Runtime.evaluate` equivalent (`window.close()` is a no-op
    on VS Code WebView tabs not opened by script). One consent dialog per VS Code session
    is acceptable for a rarely-called tool.
  - `screenshotPage` (fullPage): `page.screenshot(...)` → use `Page.captureScreenshot`
    CDP command directly (not via evaluate) — call `cdpSession.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })` and decode the base64 `data` field.
  - `screenshotSlice`: `Page.captureScreenshot` via `send()` + scroll via evaluate.
    Additional rewrites needed in the code string: `page.viewportSize()` →
    `{ width: window.innerWidth, height: window.innerHeight }`; `page.waitForTimeout(N)` →
    `await new Promise(r => setTimeout(r, N))`. Scroll-restore `finally` must be issued
    as a separate `evaluate()` call from the TypeScript caller (not inside the code string)
    since the screenshot `send()` is a separate round-trip that breaks atomicity.
  - `emulate`: `page.setViewportSize(...)` → `Emulation.setDeviceMetricsOverride` CDP command via `send()`.
  - `getDom`: uses `page.evaluate(sel => ..., JSON.stringify(selector))` — argument-passing
    pattern. Rewrite as self-contained IIFE: `(function(){ const sel = ${JSON.stringify(selector ?? null)}; return sel ? document.querySelector(sel)?.outerHTML ?? '' : document.documentElement.outerHTML; })()`.
  - `markdown`: same arg-passing pattern — inline the selector value via `JSON.stringify`
    into a self-contained IIFE. See getDom for the pattern.
  - `getConsole` / `CONSOLE_INJECT`: `CONSOLE_INJECT` uses `await page.evaluate(() => {...})` —
    not a bare JS string. Rewrite as a self-contained IIFE:
    `(function(){ if(window.__mcpConsole) return; ... })()`. `getConsole` then becomes
    two sequential `evaluate()` calls: (1) inject, (2) read buffer.
  - `clearConsole`, `scroll`, `evalJs`: zero-arg `page.evaluate()` wrappers — strip the
    wrapper and pass the inner function body directly to `Runtime.evaluate`.
- **Error mapping**: `Runtime.evaluate` returns `{ exceptionDetails }` on error. Map to the
  same `isError: true` MCP envelope that `errContent()` produces.

**Patterns to follow:**

- thimo's `CDPTab` pattern (WebSocket + `Runtime.evaluate` / `send`) — see
  [thimo/integrated-browser-mcp](https://github.com/thimo/integrated-browser-mcp) for
  the CDP command dispatch pattern. Note: `src/cdp-tab.ts` does **not** exist in this
  repo; use thimo's external source as reference only for the pattern.
- Existing `runPlaywrightCode` in [src/browserBridge.ts](src/browserBridge.ts) as the
  single call site being replaced.
- `ensureClaudeMcpEntry` in [src/install/claudeConfig.ts](src/install/claudeConfig.ts)
  for the `argv.json` read/write pattern reused by `integratedBrowserMcp.enableCdp`.
  (This file exists — U5 is complete. Follow the same atomic-write and
  `os.homedir()`-based path resolution used there.)

**Test scenarios:**

- Unit: `CdpSession.evaluate` with a mocked proxy returns the correct `.result.value`.
- Unit: fallback path fires `invokeTool` when `cdpManager` is `undefined`.
- Integration (tier-b): `eval_js` via CDP returns `"2"` for `1+1` — no consent dialog.
- Integration (tier-c): `screenshot_page` fullPage path returns valid JPEG bytes via
  `Page.captureScreenshot`.
- Integration (tier-d): `markdown` via CDP returns `# Hello` after injecting `<h1>`.
- Integration (tier-e): `get_console` captures `console.log("boom")` via CDP evaluate.

**Verification:**

- `pnpm test` passes.
- Manual session: open a page, run `eval_js` → **zero consent dialogs** after initial
  Tier A approval.
- Output channel logs `[cdp] connected to session <id>` on first use.
- `docs/DEVELOPMENT.md` `## Permission dialog scope` section updated: Tier B/C/D/E
  row changed from "consent per unique script" to "no consent (CDP path)".

---

- U13. **Remove debug probe command and refresh docs**

**Goal:** Strip the `integratedBrowserMcp.probeScreenshotSlice` command from the
extension and `package.json` `contributes.commands`. Extend `docs/DEVELOPMENT.md`
with an agent-driven "how to probe an LM tool" section that replaces the
probe's role.

**Requirements:** R10

**Dependencies:** U4 (the helpers it extracted), U10 (the slice tool that
supersedes the probe's experimental code path)

**Files:**

- Modify: `src/extension.ts` — delete the `probeScreenshotSlice` command and its
  helper block, and the `runCdpGate` gate experiment command. Remove the now-unused
  `extractRpcResult` local copy (it lives in `browserBridge.ts` since U4).
- Modify: `package.json` — remove `integratedBrowserMcp.probeScreenshotSlice` and
  `integratedBrowserMcp.runCdpGate` from `contributes.commands`.
- Modify: `docs/DEVELOPMENT.md` — replace the implicit reliance on the probe with
  a section titled "Probing a new LM tool" that walks through: list `vscode.lm.tools`,
  read the input schema, write a one-off Mocha test or use Claude Code to call the
  tool via our MCP and inspect the result shape.
- Modify: `README.md` — update the tool list to reflect the full surface added
  by Phases 1–5. Include the verbatim `eval_js` warning under that tool's
  entry: *"Runs arbitrary JavaScript in the open page — same trust model as
  the DevTools console. Don't pass untrusted input."*

**Approach:**

- Confirm no other code path imports anything from the probe block before
  deletion.
- The new doc section is ~30 lines: it explains the agent-driven workflow,
  cites the `extractRpcResult` parse path as the canonical helper, and points
  at U4's tests as the reference shape examples.

**Patterns to follow:**

- Existing "Manual integration tests" section in `docs/DEVELOPMENT.md` for the
  doc voice.

**Test scenarios:**

- Test expectation: none — pure deletion + doc update.

**Verification:**

- `pnpm test` passes after the deletion.
- `grep -r probeScreenshotSlice src/ package.json` returns no matches.
- `docs/DEVELOPMENT.md` includes the new section.

---

- U14. **Element selection — push picked element via SSE**

**Goal:** When the user selects an element in the Integrated Browser, push the
element's data (screenshot + accessible name + computed styles snapshot + position
rect + innerText) to all active MCP sessions via the SSE channel so Claude Code
receives it as automatic context. This was prior plan U8 (post-v1, planned), moved
here for execution.

**Requirements:** R13

**Dependencies:** U2 (clean home for handler code); independent of all tool units

**Files:**

- Create: `src/install/elementSelector.ts` — picker invocation + payload assembly
  - SSE broadcast to subscribed sessions.
- Modify: `src/mcpServer.ts` — expose a `broadcastToSubscribers(notification)`
  method on `McpBridgeServer` that iterates a `Set<sessionId>` subscriber set
  and calls `transport.send(notification)` for each. `SessionEntry` gains a
  `subscriptions: { elementSelection: boolean }` field (default `false`).
- Modify: `src/tools/diagnostic.ts` (or a new `src/tools/subscribe.ts`) —
  register `subscribe_element_selection` and `unsubscribe_element_selection`
  tools that flip the current session's flag.
- Modify: `src/extension.ts` — register the picker command; instantiate
  `elementSelector` and wire it to the broadcast method.
- Modify: `package.json` — add `contributes.commands` entry for the picker
  command and (if Path A is viable) `contributes.menus.editor/title` entry with
  a `when` clause scoped to the Integrated Browser's `viewType`.

**Approach:**

- **Gate first.** Run `vscode.commands.getCommands(true)` once during U14 work
  and grep for `browser.*pick*`, `browser.*inspect*`, `editor.action.inspectTM*`,
  and anything else that looks like an element picker. Document the findings in
  `docs/DEVELOPMENT.md`.
  - **Path A (button or event interception):** if a picker command exists,
    contribute a toolbar button on the browser viewType and invoke the command;
    capture the result; assemble the payload and broadcast it. Also probe
    `vscode.lm.onDidReceiveTool*` (or similar) to see if VS Code fires an event
    when its own picker tool is invoked — if so, observe and re-emit without
    needing a button.
  - **Path B fallback (downgraded scope):** if no picker exists, ship a smaller
    command — `Integrated Browser MCP: Send current screenshot to agent` — that
    captures `screenshot_page` of the active browser tab and pushes it. Do *not*
    implement a full hover-highlight + click-capture system in JS; that's
    significant scope outside the bounds of this plan.
- **Broadcast plumbing:** a notification is a JSON-RPC message with no `id` and
  a `method` like `"notifications/elements/selected"`. Body shape:

  ```
  {
    "method": "notifications/elements/selected",
    "params": {
      "pageId": "<uuid-if-known>",
      "screenshot": { "data": "<base64>", "mimeType": "image/jpeg" },
      "accessibleName": "...",
      "innerText": "...",
      "rect": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "computedStyles": { "color": "...", "font-size": "..." }
    }
  }
  ```

- **Path A interop prerequisite (gate experiment, ~30 minutes, do this before
  designing the picker UX):** the broadcast assumes `transport.send()` actually
  reaches a connected Claude Code session. `StreamableHTTPServerTransport`'s
  server-initiated messages require the client to hold a `GET /mcp` SSE stream
  open. Start a real Claude Code session, fire a no-op `transport.send()`, and
  confirm receipt. If Claude Code does not keep the GET channel open, U14 must
  pivot to a polling/pull pattern (a new MCP tool the agent calls to fetch
  the latest selection) — at which point U14 is a different feature and needs
  re-planning.
- **No active session:** if `McpBridgeServer.sessionCount === 0` when the button
  fires, show a VS Code info notification with text `"No Claude Code session
  connected — start Claude Code in a terminal to connect"` plus an `Open setup
  docs` button that opens `docs/DEVELOPMENT.md` in the editor.
- **Subscribe model (resolved 2026-05-18):** picker pushes use **explicit
  subscription**. Agents must call `subscribe_element_selection` once per
  session to start receiving notifications. This eliminates cross-session
  leakage by default and makes the receiving set explicit at the protocol
  level. Two additional MCP tools register alongside the picker:
  - `subscribe_element_selection` — `{ }` → marks the current session as a
    subscriber. Idempotent. Returns `{ subscribed: true }`.
  - `unsubscribe_element_selection` — `{ }` → removes subscription. Returns
    `{ subscribed: false }`.
- **No-subscriber feedback (failsafe):** when the user clicks the picker
  button and `subscribers.size === 0`, show a VS Code information notification
  with exact text: *"Picked element ready but no agent is subscribed to
  receive it. The connected agent must call `subscribe_element_selection`
  once per session — see README for setup."* Include an `Open setup docs`
  button that opens `docs/DEVELOPMENT.md` at the relevant section. This is
  the explicit nudge to surface the missing wiring rather than failing
  silently. Log the same message to the output channel.
- **Threat model:** localhost-only, single-developer machine. Subscribers are
  the explicit consent boundary — only agents the user has wired up via their
  MCP setup can subscribe. Element-selection data is gated on both user
  intent (clicking the picker button) and agent intent (calling subscribe).
- **Toolbar button visuals** (Path A): contribute via
  `contributes.menus.editor/title` with icon `$(codicon-inspect)`, tooltip
  `"Send selected element to Claude Code"`, aria-label same as tooltip. Path B
  fallback uses icon `$(codicon-device-camera)` with tooltip `"Send screenshot
  to Claude Code"` to make the downgraded capability visually distinct from a
  true picker.

**Execution note:** Investigation-led — the gate decides whether Path A or Path
B ships. Capture the gate outcome in `docs/DEVELOPMENT.md` regardless of which
path lands.

**Patterns to follow:**

- Prior plan U8 design notes in
  [docs/plans/2026-05-15-001-feat-integrated-browser-mcp-plan.md](docs/plans/2026-05-15-001-feat-integrated-browser-mcp-plan.md)
  (lines ~741-797).
- `StreamableHTTPServerTransport`'s server-initiated message support (the
  `GET /mcp` SSE channel is already wired up — confirmed by prior U2).

**Test scenarios:**

- Happy path (manual, Path A): with a Claude Code session active, click an
  element in the browser → Claude Code receives a notification with the element
  data.
- Edge case: no active session → VS Code info notification shown; no broadcast.
- Edge case: two simultaneous sessions → both receive the notification.
- Gate failure: picker command not found → Path B ships; the new command is
  registered and the broadcast plumbing still works.

**Verification:**

- Manual: click → Claude Code session log shows the inbound notification with
  the expected payload shape.

---

- U15. **Multi-window support**

**Goal:** Allow the extension to run in multiple VS Code windows simultaneously
without port conflicts. Each window's MCP server is reachable on its own port;
agents can discover all running instances via a per-user registry file. This was
listed under "Deferred to Follow-Up Work" in the prior plan and is now in scope.

**Requirements:** R12

**Dependencies:** U2 (HTTP/session infrastructure), U5 (auto-register; the
registry interacts with the Claude Code config decision)

**Files:**

- Modify: `src/mcpServer.ts` — when the configured port is in use, retry once
  with port `0` (OS-assigned) and log the actual bound port.
- Create: `src/install/portRegistry.ts` — `registerInstance(port): Disposable`
  that writes `{ pid, port, windowTitle, startedAt }` into the registry file
  and removes the entry on disposal. Prunes stale entries (PID no longer alive)
  on every write.
- Modify: `src/extension.ts` — call `registerInstance(server.port)` after the
  server starts; push the returned disposable into `context.subscriptions`.
- Modify: `src/install/claudeConfig.ts` (U5) — when registering the MCP entry,
  detect multi-instance scenarios and ask the user whether to point at this
  specific window (port-pinned) or at the "primary" instance. Default: pin to
  this window's port for clarity.
- Modify: `docs/DEVELOPMENT.md` — document the registry file location, format,
  and the multi-window UX.

**Approach:**

- **Registry file location:**
  - Linux/macOS: `~/.claude/integrated-browser-mcp-instances.json` (under the
    `.claude` dir so it sits next to Claude Code's own state).
  - Windows: `%APPDATA%\Claude\integrated-browser-mcp-instances.json`.
- **File format:**

  ```json
  {
    "instances": [
      {
        "pid": 12345,
        "port": 3100,
        "windowTitle": "vscode-integrated-browser-mcp",
        "appName": "Visual Studio Code",
        "startedAt": "2026-05-18T10:00:00Z"
      }
    ]
  }
  ```

  `appName` comes from `vscode.env.appName` (e.g. `"Visual Studio Code"` for
  Stable, `"Visual Studio Code - Insiders"` for Insiders). This lets the U5
  picker UI disambiguate when Stable and Insiders run side-by-side — common
  for extension developers.
- **Lockfile-protected read-modify-write:** use `proper-lockfile` (or an
  equivalent O_EXCL temp-lock pattern) to serialize the critical section
  across simultaneous-startup races. Without this, two windows starting
  within milliseconds can each read the same baseline, each compute updated
  arrays, and the second writer overwrites the first — losing an entry.
  Lockfile waits ~50ms with backoff; if it can't acquire, logs and retries
  once before giving up.
- **Atomic write within the lock:** assemble the new JSON in memory; write
  to `<file>.tmp-<pid>` then `fs.renameSync(tmp, final)`. Prevents torn writes
  if the process dies mid-write.
- **PID liveness check:** on each write, prune entries whose `pid` does not
  exist (POSIX: `process.kill(pid, 0)` throws ESRCH if dead; Windows: open the
  process handle via `process` module or accept staleness and prune after a
  fixed age). Choose the simpler approach in implementation.
- **Port-0 fallback path:** on EADDRINUSE for the configured port, try once
  with port `0`. If that also fails (unlikely), surface the existing error
  notification.
- **Window identification:** use `vscode.workspace.name` when available, else
  the first workspace folder name, else "(no workspace)".
- **MCP discovery for agents:** the registry file is the contract. Agents can
  read it to enumerate running instances. Document this in
  `docs/DEVELOPMENT.md`.

**Approach interaction with U5 (auto-register):**

- If the user has only one window running, U5's behavior is unchanged: write
  `{ url: http://127.0.0.1:<port>/mcp }` to `~/.claude.json`.
- If multiple instances are detected at U5 prompt time, use
  `vscode.window.showQuickPick` (not `showInformationMessage` — that only
  supports a few button labels, not a dynamic list). Item shape:
  - label: e.g. `"My Project (Insiders, port 3101)"` built from
    `windowTitle`, an `appName` short tag (`Insiders` only if not Stable),
    and `port`.
  - description: optional, the workspace folder path if available.
  - The current window's entry has a `"$(check) This window"` detail suffix
    so the user can identify it.
  - placeholder: `"Which window should Claude Code connect to?"`
  - `ignoreFocusOut: true` so the picker doesn't dismiss on focus loss.
  - On `ESC` / cancel: do NOT write the config, do NOT set
    `globalState.claudeConfig.offered` (so the prompt re-appears on next
    activation if the user wasn't ready).
  - If the registry contains more than 5 entries: surface a warning above
    the picker that the registry may be stale (`PID liveness check should
    have pruned dead ones — investigate if you see many entries`).
- The selected port is what gets written to `~/.claude.json`. Subsequent
  instances do *not* overwrite the config.

**Test scenarios:**

- Happy path: first window binds 3100; second window EADDRINUSE → falls back
  to port 0 → registry shows both entries with distinct ports.
- Edge case: first window closes cleanly → its entry is removed; second
  window's entry remains.
- Edge case: VS Code crashes (no deactivate) → stale entry persists until
  another window writes the registry; that write prunes it.
- Edge case: simultaneous startup of two windows → atomic rename guarantees
  one wins each write; registry ends up consistent.
- Edge case: registry file does not exist → first write creates it.
- Edge case: registry file is malformed JSON → log a warning, overwrite with a
  fresh entry list (do not corrupt user state with a stale parse).
- Integration: two-window scenario, Claude Code config points at window 1's
  port → only window 1's pages appear in `list_pages`. Same agent can also
  open a second session to window 2's port (manual config edit) and target
  that window independently.

**Verification:**

- Open two VS Code windows in the dev host. Both servers start. Registry file
  contains two entries with the right ports. Closing one removes its entry.

---

## System-Wide Impact

- **Interaction graph:** the `pages` map in each `SessionEntry` is now mutated by
  three places: tool handlers (existing), the page adopter (U6), and the
  console-capture auto-injector (U12, indirectly via `open_browser_page`). Keep
  mutations synchronous within their entry-point boundary; never lock the map
  across an `await`.
- **Error propagation:** every tool registrar wraps its handler with `errContent`.
  Failures inside `run_playwright_code` (parse failures from `extractRpcResult`,
  decode failures from `decodeBuffer`) bubble up as standard errors with the same
  `isError: true` envelope. The auto-injector (U12) fire-and-forgets — failures
  there log but never block `open_browser_page`.
- **State lifecycle risks:** `screenshot_slice` (U10) mutates scroll position and
  optionally viewport. Both must be restored. Viewport restore is a separate
  decision — it is *not* restored in v1 because callers explicitly opted into
  `emulate`. Document this.
- **API surface parity:** the MCP tool surface is the externally visible contract.
  Adding new tools is additive (safe). Changing the schema of an existing tool
  (`screenshot_page` in U9) must keep all existing fields working unchanged.
- **Integration coverage:** unit tests cover registration shape and helpers.
  Live-DOM behavior (Tiers B/C/D/E) cannot be proven by mocks — extend
  `docs/DEVELOPMENT.md` with TC9–TC15 (or however many) so they are runnable.
- **Unchanged invariants:** `read_page`'s output format (VS Code's pre-formatted
  accessibility tree with `ref` IDs) does not change. `close_page`'s "(browser
  tab may still be visible)" behavior is preserved. `pageId` regex
  `/Page ID:\s*(\S+)/` stays exact (capital P, space) — linters that suggest
  lowercase are wrong here.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `run_playwright_code` consent caches per unique script content, not per tool — every distinct Tier B/C/D/E call triggered a dialog. | U17 replaces all `run_playwright_code` calls with CDP `Runtime.evaluate`, eliminating script-execution dialogs. Tier A one-time dialogs (~5–6 at session start) remain. |
| VS Code emits no event for externally-opened tabs → page adoption (U6) falls back to polling. | U6 acceptance is "passive registration" — polling at a coarse interval (2s) is acceptable. Push notifications are explicitly deferred. |
| Adopted `pageId`s (U6) cannot drive `vscode.lm.invokeTool` because VS Code's tools require *their* page identifier. | Investigation step in U6 verifies this before scope-locking. If true, U6 ships as "advertise the URL in `list_pages`" and tool calls return a clear error for adopted pages. |
| `run_playwright_code` Result-string parsing breaks in a future VS Code update. | The probe command stays in until U13 (after Tiers A–E land); helper tests in U4 lock the parse contract. If VS Code changes the shape, only one helper needs updating. |
| Page CSP blocks the console-capture injection (U12). | Auto-inject is fire-and-forget; failure is logged but does not break `open_browser_page`. Tool descriptions document the limitation. |
| Markdown walker (U11) generates poor output on JS-heavy pages with non-semantic markup. | Documented limitation; users can pass `selector` to scope. No third-party fallback (Turndown) — scope creep. |
| Schema for `hover_element` / `drag_element` / `handle_dialog` differs from what we anticipate. | U7 explicitly probes `vscode.lm.tools[*].inputSchema` before implementation. No assumptions in the plan. |
| `claude.json` config file format drifts (Claude Code adds new top-level keys). | U5 uses read-modify-write JSON merge, never replace. Idempotency check prevents duplicate entries. |
| VS Code exposes no element-picker command → U14 falls back to a downgraded "send screenshot to agent" command. | U14's gate explicitly inspects `vscode.commands.getCommands()` before committing to Path A. Path B fallback is scoped down to avoid runaway scope (no full hover-highlight + click-capture system). |
| Two-window simultaneous startup races on the registry file. | U15 uses atomic write (`<file>.tmp` + `fs.renameSync`). PID liveness check prunes stale entries on every write. |
| Auto-register (U5) writes the wrong port when multiple windows exist. | U15 modifies U5's prompt to surface the multi-instance case and let the user pick which window's port goes into `~/.claude.json`. |

---

## Documentation / Operational Notes

- `docs/DEVELOPMENT.md` gains: a `## Permission dialog scope` section (U3), TC9+
  (U7 onward), a "Probing a new LM tool" section (U13), and an updated
  `## Known limitations` removing the `Permission dialog when opening or closing
  a page` row if U3 lands a fix.
- `README.md` may need an updated tool list when the work completes — defer
  until the final release packaging; not a per-unit step.
- CI: `.github/workflows/test.yml` added in Phase 0 — runs `xvfb-run -a pnpm test`
  on every push and PR. Per-Tier integration test files accrue alongside each
  tool unit in Phase 4.
- Releases: keep the probe command available until U13 lands, but ensure U13 is
  merged before the next `release-please` cuts a release. Verify via
  `package.json` diff in the release PR.

---

## Phased Delivery

### Phase 0 — Pre-flight spikes (~1–2 days total)

- U3 step 4 (consent-prompt experiment) — gates the architectural bet that
  shapes Tier B/C/D/E routing.
- U16 scaffolding spike — stand up `.github/workflows/test.yml` running the
  existing 17 tests under `xvfb-run`. Verify the Integrated Browser registers
  in CI. Gates whether per-Tier integration tests in U16 are viable.

Both spikes are independent and can run in parallel. Results are recorded in
`docs/DEVELOPMENT.md`. If the consent spike disproves the workhorse bet,
U2's file structure is adjusted before Phase 1 starts. If the CI spike fails,
U16 falls back to local-only release-gate per its Approach.

**Results (2026-05-19):**

U3 consent experiment — **complete.** 6 dialogs for 6 calls (1 × `open_browser_page`,
5 × `run_playwright_code`). Per-call consent on first invocation; trust caches per
tool for the session. Workhorse routing confirmed. See U3 Approach for full findings.

U6 gate (discovered during U3 probe) — **partially complete.** `open_browser_page`
called on an already-open URL returns the existing tab's pageId (behavior a, no
duplicate). Response format is `[pageId] Title (URL) (active)` — different from
the happy-path `Page ID: <uuid>`. `extractPageId` must be extended in U6.
`tabGroups` enumeration — **resolved during U6 implementation**: `vscode.window.tabGroups.all`
correctly yields `TabInputWebview` entries with `viewType === 'simpleBrowser.view'` for
integrated browser tabs. `enumerateVisibleBrowserTabs()` ships in `src/browserBridge.ts`.

U16 CI scaffolding spike — **complete (2026-05-19).** `.github/workflows/test.yml`
ships; `xvfb-run -a pnpm test` runs clean on every push. 18/18 tests pass,
including the LM tool availability spike (`open_browser_page` registers in the
headless extension host with `workbench.browser.enableChatTools: true`). Per-Tier
integration tests are viable in CI. The open question — whether `invokeTool` can
open a real browser tab in a renderer-less environment — is deferred to Phase 4
when the tool units land.

---

### ~~Phase 1 — Structural foundation~~ — complete (2026-05-20)

- U1 — `src/util/mcpResult.ts`, `src/tools/_schemas.ts`, `src/tools/_context.ts` extracted
- U2 — `mcpServer.ts` split into 5 `src/tools/*.ts` registrars

### ~~Phase 2 — Investigation & UX~~ — complete (2026-05-20)

- U3 — `docs/DEVELOPMENT.md` permission dialog scope documented
- U4 — `extractRpcResult`, `decodeBuffer`, `runPlaywrightCode` in `browserBridge.ts`; startup parse probe in `extension.ts`; `parseContract` on `McpBridgeServer`

### ~~Phase 3 — Features~~ — complete (2026-05-20)

- U5 — `src/install/claudeConfig.ts`: symlink-safe, atomic write, globalState-gated auto-register; 9 new merge/idempotency tests
- U6 — `list_visible_pages` + `attach_visible_page` in `src/tools/page.ts`; `extractPageId` extended for "already open" UUID format; `enumerateVisibleBrowserTabs()` via `tabGroups`

### ~~Phase 4 — Tools (fans out)~~ — complete (2026-05-20)

- U7 — `hover_element`, `drag_element`, `handle_dialog` in `src/tools/interaction.ts`; `hoverElement`, `dragElement`, `handleDialog` wrappers in `browserBridge.ts`
- U8 — `eval_js`, `get_dom` in `src/tools/content.ts`; `scroll` in `src/tools/interaction.ts`; `emulate` in `src/tools/visual.ts`; `get_url` in `src/tools/page.ts`; `parseContractGuard` helper in `src/util/mcpResult.ts`; 18 tools total
- U9 — `screenshot_page` extended with `fullPage`/`waitMs`; branches to `run_playwright_code` + `decodeBuffer` when either is set; 38 tests passing
- U10 — `screenshot_slice` in `src/tools/visual.ts`; `screenshotSlice` + `normalizeSlice` in `browserBridge.ts`; Pythonic negative indexing, scroll-restore via try/finally; 6 normalizeSlice unit tests; 44 tests passing
- U11 — `markdown` in `src/tools/content.ts`; `markdown()` bridge with ~30-line inline DOM walker (no deps); scopes to `<main>`/`<body>`/selector; 44 tests passing
- U12 — `get_console`/`clear_console` in `src/tools/diagnostic.ts`; Mechanism B (in-page injection via `page.evaluate`, idempotent re-inject on every `get_console`); auto-inject fire-and-forget in `open_browser_page`; 44 tests passing
- U16 — `src/test/integration/tier-b.test.ts` (eval_js), `tier-c.test.ts` (screenshot_page), `tier-d.test.ts` (markdown), `tier-e.test.ts` (get_console); shared `_helpers.ts` McpTestClient on port 3198; graceful skip when browser unavailable; DEVELOPMENT.md CI section added

### Phase 5 — Cross-cutting features ✅ COMPLETE (2026-05-28)

- ~~U17 gate~~ — passed (2026-05-27) via VS Code proposed `browser` API
- U17 ✅ COMPLETE (2026-05-28)
- U14 (element selection push) — **gate still required** before implementation (see U14 unit)
- U15 (multi-window support) — depends on U2, U5

### ▶ NEXT: Phase 6 — U13 (cleanup), then U14/U15 (after gates)

### Phase 6 — Cleanup

- U13 (remove probe, refresh docs)

Lands after every Phase 4 and Phase 5 unit is merged.

---

## Sources & References

- Repo: [https://github.com/Nagell/vscode-integrated-browser-mcp](https://github.com/Nagell/vscode-integrated-browser-mcp)
- Reference (competing CDP-based extension): [https://github.com/thimo/integrated-browser-mcp](https://github.com/thimo/integrated-browser-mcp) (v0.5.1, 22 tools)
- Current source: [src/extension.ts](src/extension.ts), [src/mcpServer.ts](src/mcpServer.ts), [src/browserBridge.ts](src/browserBridge.ts)
- Existing dev runbook: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Prior plans: [docs/plans/2026-05-15-001-feat-integrated-browser-mcp-plan.md](docs/plans/2026-05-15-001-feat-integrated-browser-mcp-plan.md)
- VS Code LM Tools API: [https://code.visualstudio.com/api/references/vscode-api#lm](https://code.visualstudio.com/api/references/vscode-api#lm)
- Claude Code MCP config: [https://docs.anthropic.com/en/docs/claude-code/mcp](https://docs.anthropic.com/en/docs/claude-code/mcp)
