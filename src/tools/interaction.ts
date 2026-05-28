import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bridge from '../browserBridge.js';
import type { McpContent } from '../util/mcpResult.js';
import { errContent, parseContractGuard } from '../util/mcpResult.js';
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
            return errContent(err, msg => ctx.output.appendLine(msg));
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
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('hover_element', {
        description: 'Hover over an element in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            element: elementSchema,
            ref: refSchema,
            selector: selectorSchema
        }
    }, async ({ pageId, element, ref, selector }) => {
        output.appendLine(`[tool] hover_element pageId=${pageId} element="${element}"`);
        try {
            return { content: await bridge.hoverElement(pageId, element, ref, selector) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] hover_element: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('drag_element', {
        description: 'Drag an element to a target element in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            sourceElement: z.string().describe('Human-readable description of the element to drag'),
            targetElement: z.string().describe('Human-readable description of the drop target'),
            sourceRef: z.string().optional().describe('Source element ref from snapshot (e.g. "e6")'),
            targetRef: z.string().optional().describe('Target element ref from snapshot'),
            sourceSelector: z.string().optional().describe('Source element Playwright selector'),
            targetSelector: z.string().optional().describe('Target element Playwright selector')
        }
    }, async ({ pageId, sourceElement, targetElement, sourceRef, targetRef, sourceSelector, targetSelector }) => {
        output.appendLine(`[tool] drag_element pageId=${pageId} source="${sourceElement}" target="${targetElement}"`);
        try {
            return { content: await bridge.dragElement(pageId, sourceElement, targetElement, sourceRef, targetRef, sourceSelector, targetSelector) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] drag_element: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('handle_dialog', {
        description: 'Accept or dismiss a browser dialog (alert, confirm, prompt) in the Integrated Browser.',
        inputSchema: {
            pageId: pageIdSchema,
            action: z.enum(['accept', 'dismiss']).describe('Whether to accept or dismiss the dialog'),
            text: z.string().optional().describe('Text to enter for prompt dialogs')
        }
    }, async ({ pageId, action, text }) => {
        output.appendLine(`[tool] handle_dialog pageId=${pageId} action=${action}`);
        try {
            return { content: await bridge.handleDialog(pageId, action, text) as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] handle_dialog: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });

    server.registerTool('scroll', {
        description: 'Scroll the page by a relative amount (deltaX/deltaY) or to an absolute position (x/y).',
        inputSchema: {
            pageId: pageIdSchema,
            deltaX: z.number().optional().describe('Horizontal scroll offset in pixels (relative)'),
            deltaY: z.number().optional().describe('Vertical scroll offset in pixels (relative)'),
            x: z.number().optional().describe('Absolute horizontal scroll position'),
            y: z.number().optional().describe('Absolute vertical scroll position')
        }
    }, async ({ pageId, deltaX, deltaY, x, y }) => {
        output.appendLine(`[tool] scroll pageId=${pageId} deltaX=${deltaX} deltaY=${deltaY} x=${x} y=${y}`);
        const guard = parseContractGuard(ctx.parseContract.status, ctx.parseContract.details);
        if (guard) { return guard; }
        if (x === undefined && y === undefined && deltaX === undefined && deltaY === undefined) {
            return errContent('scroll requires at least one of: deltaX, deltaY, x, y');
        }
        try {
            await bridge.scrollPage(pageId, deltaX, deltaY, x, y);
            return { content: [{ type: 'text', text: 'Scrolled.' }] as McpContent[] };
        } catch (err) {
            output.appendLine(`[error] scroll: ${err}`);
            return errContent(err, msg => ctx.output.appendLine(msg));
        }
    });
}
