import type { CdpSession } from './cdpSession.js';
import { setCaptured } from '../elementCapture.js';
import type * as vscode from 'vscode';

export async function captureNodeByBackendId(
    session: CdpSession,
    pageId: string,
    backendNodeId: number,
    output: vscode.OutputChannel
): Promise<{ tagName: string; preview: string } | null> {
    try {
        const described = await session.send('DOM.describeNode', { backendNodeId, depth: 0 }) as {
            node: { localName: string };
        };
        const tagName = described.node.localName || 'unknown';

        const htmlResult = await session.send('DOM.getOuterHTML', { backendNodeId }) as { outerHTML: string };
        const outerHTML = htmlResult.outerHTML.slice(0, 2000);

        let rect = { x: 0, y: 0, width: 0, height: 0 };
        try {
            const boxResult = await session.send('DOM.getBoxModel', { backendNodeId }) as {
                model: { content: number[] };
            };
            const c = boxResult.model.content; // [x1,y1, x2,y2, x3,y3, x4,y4]
            rect = {
                x: Math.round(c[0]),
                y: Math.round(c[1]),
                width: Math.round(c[2] - c[0]),
                height: Math.round(c[7] - c[1]),
            };
        } catch { /* element may be out of view */ }

        let innerText = '';
        try {
            const resolved = await session.send('DOM.resolveNode', { backendNodeId }) as {
                object: { objectId: string };
            };
            const textResult = await session.send('Runtime.callFunctionOn', {
                objectId: resolved.object.objectId,
                functionDeclaration: 'function() { return (this.innerText || this.textContent || "").trim().slice(0, 500); }',
                returnByValue: true,
            }) as { result: { value?: unknown } };
            innerText = String(textResult.result.value ?? '');
        } catch { /* ignore */ }

        setCaptured({ pageId, tagName, innerText, outerHTML, rect, capturedAt: new Date().toISOString() });
        const preview = innerText ? ` "${innerText.slice(0, 40)}"` : '';
        output.appendLine(`[cdp] element captured: <${tagName}>${preview}`);
        return { tagName, preview };
    } catch (err) {
        output.appendLine(`[cdp] captureNodeByBackendId error: ${err}`);
        return null;
    }
}
