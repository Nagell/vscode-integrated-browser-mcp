import * as assert from 'assert';
import * as vscode from 'vscode';

// Spike: verifies that VS Code's Integrated Browser LM tools are available in
// the CI extension host. workbench.browser.enableChatTools is pre-set in
// src/test/workspace/.vscode/settings.json. If this suite fails, per-Tier
// integration tests are not viable in CI (see docs/DEVELOPMENT.md).
suite('Integration: LM tool availability', () => {
    suiteSetup(async function () {
        this.timeout(10_000);
        // Give VS Code time to register tools after the workspace opens.
        await new Promise<void>(resolve => setTimeout(resolve, 3_000));
    });

    test('open_browser_page is present in vscode.lm.tools', () => {
        const names = vscode.lm.tools.map(t => t.name);
        assert.ok(
            names.includes('open_browser_page'),
            `open_browser_page not found — available tools: [${names.join(', ') || 'none'}]`
        );
    });
});
