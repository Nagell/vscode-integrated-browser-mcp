<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Nagell/vscode-integrated-browser-mcp">
    <img src="/docs/logo.svg" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Integrated Browser MCP</h3>

  <p align="center">
    A VS Code extension that exposes the Integrated Browser as an MCP server for AI agents
    <br />
    <a href="./docs/DEVELOPMENT.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Nagell/vscode-integrated-browser-mcp/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    ·
    <a href="https://github.com/Nagell/vscode-integrated-browser-mcp/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
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
      </ul>
    </li>
    <li><a href="#available-tools">Available Tools</a></li>
    <li><a href="#settings">Settings</a></li>
    <li><a href="#known-limitations">Known Limitations</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

VS Code 1.112+ provides powerful browser agent tools — open pages, read accessibility trees, take screenshots, click elements, type text — but only exposes them to VS Code's built-in Copilot chat agent. Claude Code runs as an external CLI process and has no access to these tools.

This extension bridges that gap. It runs an MCP server inside VS Code's extension host (where VS Code APIs are accessible) and proxies tool calls from external agents to VS Code's internal browser capabilities — so Claude Code can control the in-editor browser without duplicating its implementation or losing the visual feedback of the integrated panel.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

- [![TypeScript][TypeScript]][TypeScript-url]
- [![VS Code Extension API][VSCode]][VSCode-url]
- [![Model Context Protocol SDK][MCP]][MCP-url]
- [![Express][Express]][Express-url]
- [![Zod][Zod]][Zod-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

- VS Code 1.112 or later
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

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

4. Add the MCP server to your Claude Code config

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

5. Run `claude` in your project — the `Integratedbrowser` MCP server will be listed automatically

> [!NOTE]
> VS Code may show a confirmation dialog when opening or closing a page.  
> Click **Allow** to proceed. Read, screenshot, navigate, click, and type operations run without interruption.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- AVAILABLE TOOLS -->
## Available Tools

| Tool | Description |
|---|---|
| `open_browser_page` | Open a URL in the Integrated Browser. Returns a `pageId` required by all other tools. Always pass a `url` — if the page is already open, VS Code will simply navigate to it. Pass `forceNew: true` to open a second tab. |
| `read_page` | Read the current page content as an accessibility tree (title, URL, element refs). |
| `screenshot_page` | Take a screenshot of the page or a specific element (`ref` or `selector`). |
| `navigate_page` | Navigate to a URL, or go `back` / `forward` / `reload`. |
| `click_element` | Click an element. Provide `element` (human description) plus `ref` from a snapshot or a `selector`. |
| `type_in_page` | Type text or press a key (e.g. `"Enter"`, `"Control+a"`). Target with `ref` or `selector`. |
| `list_pages` | List all pages opened in this session with their page IDs and URLs. |
| `close_page` | Close a page and remove it from the session. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SETTINGS -->
## Settings

| Setting | Default | Description |
|---|---|---|
| `integratedBrowserMcp.port` | `3100` | Port the MCP server listens on |
| `integratedBrowserMcp.autoStart` | `true` | Start the server automatically on VS Code launch |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- KNOWN LIMITATIONS -->
## Known Limitations

- **`list_pages` shows the URL at open time**, not the current URL after link clicks or form submissions. It updates on explicit `navigate_page` calls. Use `read_page` to get the live URL.
- **WSL + native Windows Claude Code**: `os.homedir()` resolves to the WSL Linux home, not the Windows home. Add the MCP config manually to the Windows-side `%APPDATA%\Claude\claude.json`.
- No multi-window support in v1 — tool calls always target the browser in the window where the extension activated.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] MCP HTTP server with stateful session management
- [x] Browser bridge via `vscode.lm.invokeTool`
- [x] `open_browser_page`, `read_page`, `screenshot_page`
- [x] `navigate_page` (url / back / forward / reload)
- [x] `click_element`, `type_in_page`
- [x] `list_pages`, `close_page`
- [x] Multi-tab support via `forceNew`
- [ ] Auto-configure `~/.claude.json` on first activation
- [ ] Element selection push — intercept VS Code's browser element picker and forward the payload to Claude Code via MCP server-sent events

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
[MCP]: https://img.shields.io/badge/MCP%20SDK-000000?style=for-the-badge&logo=anthropic&logoColor=white
[MCP-url]: https://github.com/modelcontextprotocol/typescript-sdk
[Express]: https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[Zod]: https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white
[Zod-url]: https://zod.dev/
