import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent } from '../util/mcpResult.js';
import { pageIdSchema, refSchema, selectorSchema, elementSchema } from './_schemas.js';
import type { ToolContext } from './_context.js';

export function registerInteractionTools(server: McpServer, ctx: ToolContext): void {
    const { output } = ctx;

    server.registerTool('click_element', {
        description: 'Click an element in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            element: elementSchema,
            ref: refSchema,
            selector: selectorSchema
        }
    }, async ({ pageId, element, ref, selector }) => {
        output.appendLine(`[tool] click_element pageId=${pageId} element="${element}"`);
        try {
            return { content: await bridge.clickElement(pageId, element, ref, selector) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] click_element: ${err}`);
            return errContent(err);
        }
    });

    server.registerTool('type_in_page', {
        description: 'Type text or press a key in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            text: z.string().optional().describe('Text to type'),
            key: z.string().optional().describe('Key to press (e.g. "Enter", "Control+c")'),
            ref: refSchema,
            selector: selectorSchema,
            element: z.string().optional().describe('Human-readable element description')
        }
    }, async ({ pageId, text, key, ref, selector, element }) => {
        output.appendLine(`[tool] type_in_page pageId=${pageId} text=${text} key=${key}`);
        try {
            return { content: await bridge.typeInPage(pageId, text, key, ref, selector, element) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] type_in_page: ${err}`);
            return errContent(err);
        }
    });
}
