<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Nagell/vscode-integrated-browser-mcp">
    <img src="assets/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Integrated Browser MCP</h3>

  <p align="center">
    A VS Code extension that exposes the Integrated Browser as an MCP server for AI agents
    <br />
    <a href="./docs/DEVELOPMENT.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Nagell/vscode-integrated-browser-mcp/issues/new?labels=bug&template=bug_report.md">Report Bug</a>
    ·
    <a href="https://github.com/Nagell/vscode-integrated-browser-mcp/issues/new?labels=enhancement&template=feature_request.md">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#claude-code">Claude Code</a></li>
        <li><a href="#cline">Cline</a></li>
        <li><a href="#continuedev">Continue.dev</a></li>
      </ul>
    </li>
    <li><a href="#available-tools">Available Tools</a></li>
    <li><a href="#settings">Settings</a></li>
    <li><a href="#commands">Commands</a></li>
    <li><a href="#known-limitations">Known Limitations</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

VS Code 1.112+ provides powerful browser agent tools — open pages, read accessibility trees, take screenshots, click elements, type text — but only exposes them to VS Code's built-in Copilot chat agent. External AI agents have no access to these tools.

This extension bridges that gap. It runs an MCP server inside VS Code's extension host (where VS Code APIs are accessible) and proxies tool calls from any MCP-compatible AI agent to VS Code's internal browser capabilities — without duplicating the browser implementation or losing the visual feedback of the integrated panel.

Works with any agent that supports the MCP streamable HTTP transport running on the same machine: **Claude Code**, **Cline**, **Continue.dev**, and others.

### Built With

[![TypeScript][TypeScript]][TypeScript-url] [![VS Code Extension API][VSCode]][VSCode-url] [![Model Context Protocol SDK][MCP]][MCP-url] [![Express][Express]][Express-url] [![Zod][Zod]][Zod-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

- VS Code 1.112 or later
- An MCP-compatible AI agent (Claude Code, Cline, Continue.dev, or similar)

### Installation

1. Install the extension from the VS Code Marketplace

2. Enable the browser tools in VS Code settings

   ```json
   "workbench.browser.enableChatTools": true
   ```

3. Open the Integrated Browser panel at least once  
   The browser tools are only registered after the panel has been opened.  
   Open it via the Command Palette (`Ctrl+Shift+P`) → **Integrated Browser: Open**,  
   then enter any URL (e.g. `https://example.com`).

4. Connect your MCP client — see the sections below for your agent.

> [!NOTE]
> VS Code shows a consent dialog the first time each tool is used in a session. Click **Allow** to proceed — subsequent calls in the same session run silently.
>
> To eliminate dialogs entirely, run **Integrated Browser MCP: Enable CDP** from the Command Palette after installation. It modifies `argv.json` and requires a VS Code restart.

### Claude Code

**Project-scoped** — add `.mcp.json` to your project root:

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

**User-scoped** — add to `~/.claude.json`:

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

Run `claude` in your project — the `integratedBrowser` MCP server will be listed automatically.

### Cline

Open Cline's MCP settings and add a **Remote Server** via the UI (choose *Streamable HTTP* from the transport dropdown), or edit the config file directly.

Config file locations:

- Linux/macOS: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "integratedBrowser": {
      "type": "streamableHttp",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

> [!IMPORTANT]
> The `"type": "streamableHttp"` field is required. Without it Cline silently falls back to the legacy SSE transport and the connection will fail.

### Continue.dev

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: integratedBrowser
    type: streamable-http
    url: http://localhost:3100/mcp
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- AVAILABLE TOOLS -->
## Available Tools

### Page management

| Tool | Description |
| --- | --- |
| `open_browser_page` | Open a URL. Returns a `pageId` required by all other tools. Pass `forceNew: true` to open a second tab. |
| `list_pages` | List all pages opened in this session with their IDs and URLs. |
| `close_page` | Close a page and remove it from the session. |
| `navigate_page` | Navigate to a URL, or go `back` / `forward` / `reload`. |
| `get_url` | Get the current URL of a page. |
| `list_visible_pages` | List browser tabs currently visible in VS Code (not limited to this session). |
| `attach_visible_page` | Attach a visible tab to the session by URL, returning a `pageId`. |

### Reading

| Tool | Description |
| --- | --- |
| `read_page` | Read the page as an accessibility tree (title, URL, element refs). |
| `get_dom` | Get raw HTML of the page or a specific element (`selector`). |
| `markdown` | Extract page content as clean Markdown. Optionally scope to a CSS `selector`. |
| `eval_js` | Evaluate a JavaScript expression and return the result. |

### Interaction

| Tool | Description |
| --- | --- |
| `click_element` | Click an element by `ref` (from `read_page`) or `selector`. |
| `type_in_page` | Type text or press a key (e.g. `"Enter"`, `"Control+a"`). Target with `ref` or `selector`. |
| `hover_element` | Hover over an element. |
| `drag_element` | Drag from one element to another. |
| `handle_dialog` | Accept or dismiss a browser dialog (alert / confirm / prompt). |
| `scroll` | Scroll by a delta or to an absolute position. |

### Visual

| Tool | Description |
| --- | --- |
| `screenshot_page` | Take a screenshot. Supports `fullPage`, `waitMs`, `ref`, and `selector`. |
| `screenshot_slice` | Take a viewport-sized screenshot of a specific scroll slice (supports negative indexing). |
| `emulate` | Set the browser viewport size. |

### Console

| Tool | Description |
| --- | --- |
| `get_console` | Read captured `console.log / warn / error / info / debug` output. Filter by `levels`. |
| `clear_console` | Clear the console capture buffer. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SETTINGS -->
## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `integratedBrowserMcp.port` | `3100` | Port the MCP server listens on |
| `integratedBrowserMcp.autoStart` | `true` | Start the server automatically on VS Code launch |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- COMMANDS -->
## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`).

| Command | Description |
| --- | --- |
| `Integrated Browser MCP: Start Server` | Start the MCP server manually. Useful when `autoStart` is disabled. |
| `Integrated Browser MCP: Stop Server` | Stop the running MCP server. |
| `Integrated Browser MCP: Enable CDP (dialog-free browser tools)` | Writes `enable-proposed-api` to `argv.json` so all browser tools run without consent dialogs after a VS Code restart. |
| `Integrated Browser MCP: List Available LM Tools (debug)` | Print all LM tools registered in VS Code to the *Browser MCP Debug* output channel. Helpful for verifying that the browser tools are active when troubleshooting. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- KNOWN LIMITATIONS -->
## Known Limitations

- **`list_pages` URL is stale after in-page navigation** — link clicks and form submissions don't update the stored URL. Use `get_url` or `read_page` for the live URL.
- **No multi-window support** — tool calls always target the browser in the window where the extension activated.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] MCP HTTP server with stateful session management
- [x] Browser bridge via `vscode.lm.invokeTool`
- [x] Page management: `open_browser_page`, `list_pages`, `close_page`, `navigate_page`, `get_url`, `list_visible_pages`, `attach_visible_page`
- [x] Reading: `read_page`, `get_dom`, `markdown`, `eval_js`
- [x] Interaction: `click_element`, `type_in_page`, `hover_element`, `drag_element`, `handle_dialog`, `scroll`
- [x] Visual: `screenshot_page` (fullPage / waitMs), `screenshot_slice`, `emulate`
- [x] Console capture: `get_console`, `clear_console`
- [x] CDP layer — dialog-free tool execution when proposed `browser` API is available
- [x] Auto-configure `~/.claude.json` on first activation
- [x] One-click CDP setup via `Enable CDP` command
- [ ] Element selection push — intercept VS Code's browser element picker and forward the ref to the agent via MCP server-sent events

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Dawid Nitka - [LinkedIn][linkedin-url]

Project Link: [https://github.com/Nagell/vscode-integrated-browser-mcp](https://github.com/Nagell/vscode-integrated-browser-mcp)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [VS Code Extension API — Language Model Tools](https://code.visualstudio.com/api/references/vscode-api#lm)
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge
[license-url]: ./LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/dawidnitka

[TypeScript]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[VSCode]: https://img.shields.io/badge/VS%20Code%20API-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white
[VSCode-url]: https://code.visualstudio.com/api
[MCP]: https://img.shields.io/badge/MCP%20SDK-000000?style=for-the-badge&logo=modelcontextprotocol&logoColor=white
[MCP-url]: https://github.com/modelcontextprotocol/typescript-sdk
[Express]: https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[Zod]: https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white
[Zod-url]: https://zod.dev/
