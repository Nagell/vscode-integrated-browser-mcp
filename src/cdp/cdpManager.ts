import type * as vscode from 'vscode';
import { CdpSession } from './cdpSession.js';
import type { RawCdpSession } from './cdpSession.js';

export interface BrowserTab {
    readonly url: string;
    startCDPSession(): Promise<RawCdpSession>;
}

export class CdpManager {
    private tabs = new Map<string, BrowserTab>();
    private sessions = new Map<string, CdpSession>();

    constructor(private output: vscode.OutputChannel) {}

    trackTab(pageId: string, tab: BrowserTab): void {
        this.tabs.set(pageId, tab);
    }

    removeTab(pageId: string): void {
        const session = this.sessions.get(pageId);
        if (session) {
            session.dispose();
            this.sessions.delete(pageId);
        }
        this.tabs.delete(pageId);
    }

    async ensureSession(pageId: string): Promise<CdpSession> {
        const existing = this.sessions.get(pageId);
        if (existing) { return existing; }
        const tab = this.tabs.get(pageId);
        if (!tab) { throw new Error(`CdpManager: no tab tracked for pageId=${pageId}`); }
        const raw = await tab.startCDPSession();
        const session = new CdpSession(raw);
        await session.bootstrap();
        this.sessions.set(pageId, session);
        this.output.appendLine(`[cdp] connected to session for pageId=${pageId}`);
        return session;
    }

    dispose(): void {
        for (const session of this.sessions.values()) { session.dispose(); }
        this.sessions.clear();
        this.tabs.clear();
    }
}
