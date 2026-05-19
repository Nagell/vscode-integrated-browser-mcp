import * as assert from 'assert';
import * as vscode from 'vscode';

// Spike: verifies that VS Code's Integrated Browser LM tools are available in
// the CI extension host. If this suite fails, per-Tier integration tests are
// not viable in CI and must run locally (see docs/DEVELOPMENT.md).
suite('Integration: LM tool availability', () => {
    suiteSetup(async function () {
        this.timeout(10_000);
        await vscode.workspace.getConfiguration().update(
            'workbench.browser.enableChatTools',
            true,
            vscode.ConfigurationTarget.Workspace
        );
        // Give VS Code time to register the tools after the setting change.
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
