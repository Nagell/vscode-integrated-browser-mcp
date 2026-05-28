# Changelog

## [0.4.0](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.3.0...vscode-integrated-browser-mcp-v0.4.0) (2026-05-28)


### Features

* **extension:** auto-prompt CDP setup on first activation ([9319174](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/931917443410d199e91efff63976a37e70f7b126))
* first-run CDP prompt and publish script fix ([60ef387](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/60ef3876fcbf73114809631989b50455404aee81))


### Bug Fixes

* **ci:** allow workflow_dispatch to run release-please, fix publish guard ([c1da5ca](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/c1da5ca9d38b222523ac40c50512865e5aab7f28))
* **ci:** allow workflow_dispatch to trigger release-please, fix publish guard ([437af29](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/437af2940791f387943f719d5e8f49007b45686d))
* **publish:** add --allow-proposed-apis browser to vsce publish script ([74cb608](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/74cb6086c9943d1d82bbbeafa5b964fd2b2684b5))

## [0.3.0](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.2.0...vscode-integrated-browser-mcp-v0.3.0) (2026-05-28)


### Features

* add probe command for run_playwright_code experimentation ([544b937](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/544b937b6123cb600d2ea4868bb92df0781f388e))
* tools expansion, CDP layer, and dev-mode isolation ([b065c06](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/b065c06e5d9875b80ff2fa7a8b815e59b2d375c4))
* **tools:** add Tier A (hover, drag, dialog) and Tier B (eval_js, get_dom, scroll, emulate, get_url) tools ([29fbc5e](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/29fbc5eb5b20e6315de0344f9280e7927ec3a28b))
* **U10:** add screenshot_slice tool with Pythonic negative indexing ([2ccc104](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/2ccc104b7cc315017aca3ea888fdf165642717c1))
* **U11:** add markdown tool with inline DOM walker ([a96a9f3](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/a96a9f33944ad3673a885b31a72028857421e056))
* **U12:** add get_console and clear_console tools with auto-inject ([75aa20a](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/75aa20a5b618e0da38ffd61876454fa98091e6db))
* **U16:** add per-Tier integration tests and CI test environment docs ([08732c6](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/08732c606d7519ea01ca83655d78ae9cb6813ab3))
* **U17:** add hybrid CDP layer, dev-mode isolation, and tool manual test ([f399312](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/f3993120b05ae70568bd67657335542a48111206))
* **U4:** add extractRpcResult, decodeBuffer, runPlaywrightCode helpers and startup parse probe ([b987362](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/b98736258e207c671a3f872c9406293a19c4ddb4))
* **U5:** auto-register MCP entry in Claude Code config on activation ([d5ba257](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/d5ba257063cda2eba7da00b7228dc52aa915db5e))
* **U6:** add attach_visible_page and list_visible_pages tools ([c564db3](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/c564db39a3270175dcf2210f39e11f782f976a0a))
* **U9:** extend screenshot_page with fullPage and waitMs options ([f12abda](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/f12abdab94f077d6b06699a95e4b418de444b964))


### Bug Fixes

* **extension:** handle EADDRINUSE in startServer command handler ([c3e35f0](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/c3e35f00f15f3445195b339d8bfe23a96095c584))
* **extension:** write enableCdp to all candidate argv.json paths ([c3d29c6](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/c3d29c6c30f77a1a41afbf252d930b896572355f))
* **tests:** prevent VS Code notifications from pausing browser during tests ([ba3972f](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/ba3972f129c7cb67a47870448dfc79a379c651a5))
* **U7/U12:** correct drag_element and handle_dialog VS Code parameter names ([3b856d5](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/3b856d5bf4122c67461a4e516e35debb52f995a9))

## [0.2.0](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.1.3...vscode-integrated-browser-mcp-v0.2.0) (2026-05-18)


### Features

* add workflow_dispatch trigger for manual publish ([60b67ed](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/60b67ed24bd4ceb03d389d883c78e43878b65e82))
* add workflow_dispatch trigger for manual publish ([922433f](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/922433fc49494fb6d9cae455c83268ceb7196627))

## [0.1.3](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.1.2...vscode-integrated-browser-mcp-v0.1.3) (2026-05-18)


### Bug Fixes

* rename displayName to avoid marketplace conflict ([7d89033](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/7d890335d6376b840c5afa39844068e07d9b13f0))
* rename displayName to avoid marketplace conflict ([341ea1c](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/341ea1c1815f9d49c19b3371af07360e2201544b))

## [0.1.2](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.1.1...vscode-integrated-browser-mcp-v0.1.2) (2026-05-18)


### Bug Fixes

* approve esbuild build scripts for pnpm v10.30.3 CI ([b360d9a](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/b360d9ad2a61acfd8721a254b660eb12576a10e1))
* approve esbuild build scripts for pnpm v10.30.3 CI ([3e7b020](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/3e7b020e2e6b76db339c3babd3a57f3b746c3eae))

## [0.1.1](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.1.0...vscode-integrated-browser-mcp-v0.1.1) (2026-05-17)


### Bug Fixes

* approve esbuild build scripts in pnpm lockfile for CI ([04100f3](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/04100f3f5da289306a0b4649917586bc7aefa65d))
* approve esbuild build scripts in pnpm lockfile for CI ([6a80bee](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/6a80bee68e21c49e9fe0b3293274d5cbed7dc8a1))

## [0.1.0](https://github.com/Nagell/vscode-integrated-browser-mcp/compare/vscode-integrated-browser-mcp-v0.0.1...vscode-integrated-browser-mcp-v0.1.0) (2026-05-17)


### Features

* add implementation plan for VS Code Integrated Browser MCP with detailed tasks and architecture ([1c3b99d](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/1c3b99d16004a520aa847c1ff753e323fdab3709))
* close_page, list_pages, forceNew multi-tab support ([f46432f](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/f46432f11a84652af62b9db8349a76750f9881f9))


### Bug Fixes

* **bridge:** correct resultToMcp type, propagate closePage errors ([ceda0bd](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/ceda0bd2aa9af451c8673593785dd2f6533dcf97))
* **build:** add createRequire shim for CJS deps in ESM bundle ([ead521a](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/ead521ac6316d67ea0bcc145f4473d2c00f2c4ff))
* **build:** bundle with esbuild for correct vsix packaging ([ab5ebfe](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/ab5ebfe55f20e84f49fe28e00134248a43e17094))
* error handling, type safety, and user-facing diagnostics ([3c24279](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/3c24279bbf98a8539fa3c97a730b05b413511155))
* mocha types visibility and dev host workspaceFolder ([41de1d1](https://github.com/Nagell/vscode-integrated-browser-mcp/commit/41de1d11d49fda6c7867d36007fa1fa94cfc2158))
