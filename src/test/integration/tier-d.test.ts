import * as assert from 'assert';
import { McpTestClient } from './_helpers.js';

suite('Integration: Tier D — markdown', () => {
    let client: McpTestClient;
    let pageId: string | undefined;

    suiteSetup(async function () {
        this.timeout(15_000);
        client = new McpTestClient();
        await client.start();
        pageId = await client.openPage('about:blank');
    });

    suiteTeardown(async () => {
        await client?.stop();
    });

    test('markdown returns "# Hello" after injecting <h1>Hello</h1>', async () => {
        if (!pageId) { return; }
        await client.call('eval_js', { pageId, expression: 'document.body.innerHTML = "<h1>Hello</h1>"' });
        const result = await client.call('markdown', { pageId });
        assert.ok(!result.isError, `unexpected error: ${result.content[0]?.text}`);
        const text = result.content.find(c => c.type === 'text')?.text ?? '';
        assert.ok(text.includes('# Hello'), `expected "# Hello" in markdown output: ${text}`);
    });
});
