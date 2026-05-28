import * as assert from 'assert';
import { McpTestClient } from './_helpers.js';

suite('Integration: Tier E — get_console', () => {
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

    test('get_console captures console.log("boom") fired via eval_js', async () => {
        if (!pageId) { return; }
        // Prime the capture buffer (idempotent inject + returns current state)
        await client.call('get_console', { pageId });
        // Fire the log
        await client.call('eval_js', { pageId, expression: 'console.log("boom")' });
        // Read the buffer
        const result = await client.call('get_console', { pageId });
        assert.ok(!result.isError, `unexpected error: ${result.content[0]?.text}`);
        const text = result.content.find(c => c.type === 'text')?.text ?? '';
        assert.ok(text.includes('boom'), `expected "boom" in console output: ${text}`);
    });
});
