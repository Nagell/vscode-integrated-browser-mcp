import * as assert from 'assert';
import { McpTestClient } from './_helpers.js';

suite('Integration: Tier B — eval_js', () => {
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

    test('eval_js 1+1 returns "2"', async () => {
        if (!pageId) { return; }
        const result = await client.call('eval_js', { pageId, expression: '1 + 1' });
        assert.ok(!result.isError, `unexpected error: ${result.content[0]?.text}`);
        const text = result.content.find(c => c.type === 'text')?.text ?? '';
        assert.strictEqual(text, '"2"');
    });
});
