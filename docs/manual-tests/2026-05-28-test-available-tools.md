# Integrated Browser MCP — Full Tool Tour Reference

## Tool List (22 tools)

| # | Tool | Requires User Attention | Result / Behavior |
|---|---|---|---|
| 1 | `open_browser_page` | **YES** | Opens a URL in VS Code integrated browser, returns `pageId`. Required by all other tools. |
| 2 | `navigate_page` | **YES** | Navigates existing page to new URL (or back/forward/reload). Visual change visible in panel. |
| 3 | `close_page` | **YES** | Removes tab from session. Visual change visible in panel. |
| 4 | `list_pages` | no | Lists session-tracked pages by ID + original open URL. |
| 5 | `list_visible_pages` | no | Lists externally opened VS Code Simple Browser tabs (not session-managed ones). |
| 6 | `get_url` | no | Returns original URL the page was opened with — **stale after in-page navigation**. |
| 7 | `attach_visible_page` | **YES** | Attaches to an already-open tab by URL. Returns existing `pageId` if found (correct dedup). |
| 8 | `click_element` | no | Clicks an element by ref, selector, or description. |
| 9 | `type_in_page` | no | Types text or presses a key into a focused element. |
| 10 | `hover_element` | no | Moves pointer over element, triggers snapshot update. |
| 11 | `drag_element` | no | ~~⚠️ Bug~~ **Fixed**: bridge now maps `sourceRef`/`sourceSelector`/`targetRef`/`targetSelector` → VS Code's `fromRef`/`fromSelector`/`toRef`/`toSelector`. MCP-facing schema keeps the descriptive names. |
| 12 | `handle_dialog` | no | ~~⚠️ Bug~~ **Fixed**: bridge now maps `action: 'accept'\|'dismiss'` → VS Code's `acceptModal: boolean`. |
| 13 | `read_page` | no | Returns full accessibility tree snapshot. Can overflow on large pages. |
| 14 | `scroll` | no | Scrolls by `deltaX`/`deltaY` (relative) or to absolute `x`/`y`. Silent — no chat output; verify with `screenshot_page`. |
| 15 | `eval_js` | no | Runs arbitrary JS in page context, returns result. ⚠️ After `navigate_page`, execution context may stay on original page (context mismatch with screenshot). |
| 16 | `get_dom` | no | Returns `outerHTML` of a selector or full document. ⚠️ Same context mismatch as `eval_js` after navigation. |
| 17 | `markdown` | no | Extracts page content as clean Markdown, scoped to `<main>` by default or a CSS selector. Best tool for feeding page content to LLMs. |
| 18 | `screenshot_page` | no | Viewport JPEG via CDP — reflects **actual rendered page** (source of truth). |
| 19 | `screenshot_slice` | no | One viewport-height slice with metadata (`totalSlices`, `scrollHeight`). ⚠️ Uses different render context than `screenshot_page` — may show stale page after navigation. |
| 20 | `emulate` | no | Sets viewport size (`width`/`height`). Affects CSS layout breakpoints but **not** the physical panel render width in screenshots. |
| 21 | `get_console` | no | ⚠️ **Bug (non-CDP path only)**: always returns `[]`. Root cause: VS Code's `run_playwright_code` does not share JS heap state across separate invocations — `window.__mcpConsole` injected in call N is not visible to `eval_js` in call N+1. **CDP path (U17) fixes this** — `session.evaluate()` shares the same execution context across all calls. |
| 22 | `clear_console` | no | Clears the console capture buffer. Works (returns "Console cleared") even though `get_console` is broken. |

---

## Tools That Required User Attention (Permission Clicks)

These 4 triggered a VS Code permission confirmation pop-up before the tool could execute:

- **#1** `open_browser_page` — opens new tab → tab lifecycle, dialog justified
- **#2** `navigate_page` — changes the URL the user sees → tab lifecycle, dialog justified
- **#3** `close_page` — removes tab from session → tab lifecycle, dialog justified
- **#7** `attach_visible_page` — Dialog fired because it was the **first call** to the `open_browser_page` LM tool in this test session (`open_browser_page` at #1 had already been closed by `close_page` at #3, resetting the consent context). In normal use — when `open_browser_page` was already approved earlier in the same session — `attach_visible_page` runs silently (same underlying LM tool, cached consent).

VS Code gates **tab-level lifecycle operations** (open, navigate, close) at the LM-tool level, not in-page interactions. This explains why `click_element`, `type_in_page`, `eval_js`, and all other interaction/content tools run silently — a finding that contradicts the initial assumption that interaction tools would also require dialogs.

**Verdict**: all 4 dialogs are correct and expected. No optimization needed.

---

## Bugs Found and Fixed

| # | Tool | Original Bug | Status |
| --- | --- | --- | --- |
| 11 | `drag_element` | Bridge passed `sourceRef`/`targetRef`; VS Code expects `fromRef`/`toRef` naming | **Fixed** — bridge now translates to `from*`/`to*` |
| 12 | `handle_dialog` | Bridge passed `action: string`; VS Code expects `acceptModal: boolean` | **Fixed** — bridge now maps `action === 'accept'` → `acceptModal` |
| 21 | `get_console` | Buffer always `[]` — `run_playwright_code` calls don't share JS heap state | **Open** — only fixed when CDP (U17) is active |

---

## Additional Behavioral Notes

- **`screenshot_page` vs `screenshot_slice`**: These use different internal contexts. After `navigate_page`, `screenshot_page` (CDP) shows the correct current page; `screenshot_slice` may show the original page.
- **`eval_js` / `get_dom` context drift**: After `navigate_page`, both tools may still execute in the original page's JS context rather than the navigated destination.
- **`get_url` is stale**: Always returns the URL the page was opened with via `open_browser_page`, not the current URL after navigation.
- **`scroll` is invisible in chat**: Always follow with `screenshot_page` to verify the scroll happened.
- **`read_page` / `type_in_page` can overflow**: Large pages produce results too big to inline — saved to disk automatically.
