import * as assert from 'assert';
import { McpTestClient } from './_helpers.js';

suite('Integration: Tier C — screenshot_page', () => {
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

    test('screenshot_page returns a JPEG image', async () => {
        if (!pageId) { return; }
        // about:blank renders nothing; inject content so VS Code produces non-empty image data
        await client.call('eval_js', { pageId, expression: `document.body.style.background='#fff'; document.body.innerHTML='<h1>screenshot test</h1>';` });
        const result = await client.call('screenshot_page', { pageId });
        assert.ok(!result.isError, `unexpected error: ${result.content[0]?.text}`);
        const img = result.content.find(c => c.type === 'image');
        assert.ok(img?.data, 'expected an image content part');
        const bytes = Buffer.from(img.data, 'base64');
        assert.strictEqual(bytes[0], 0xff, 'expected JPEG magic byte 0: 0xFF');
        assert.strictEqual(bytes[1], 0xd8, 'expected JPEG magic byte 1: 0xD8');
    });
});
