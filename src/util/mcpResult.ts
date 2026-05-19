export type { McpContent } from '../browserBridge.js';

export function errContent(err: unknown): { content: [{ type: 'text'; text: string }]; isError: true } {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}
