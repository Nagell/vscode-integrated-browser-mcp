import type * as vscode from 'vscode';
import { CdpSession } from './cdpSession.js';
import type { RawCdpSession } from './cdpSession.js';
import { captureNodeByBackendId } from './captureElement.js';

const BINDING_NAME = '__mcpPick';

const PICKER_BUTTON_SCRIPT = `(function() {
    if (document.getElementById('__mcpPickBtn')) { return; }
    const btn = document.createElement('button');
    btn.id = '__mcpPickBtn';
    btn.title = 'Pick element for Claude Code (get_element_selection)';
    btn.textContent = '⬡ Pick for Agent';
    btn.style.cssText = [
        'position:fixed', 'bottom:12px', 'right:12px', 'z-index:2147483647',
        'background:#007acc', 'color:#fff', 'border:none', 'border-radius:4px',
        'padding:5px 10px', 'font-size:12px', 'font-family:sans-serif',
        'cursor:pointer', 'opacity:0.9', 'box-shadow:0 2px 6px rgba(0,0,0,.4)',
    ].join(';');
    btn.onmouseenter = () => { btn.style.opacity = '1'; };
    btn.onmouseleave = () => { btn.style.opacity = '0.9'; };
    btn.onclick = () => { window.${BINDING_NAME}?.('pick'); };
    document.body?.appendChild(btn);
})()`;

export interface BrowserTab {
    readonly url: string;
    startCDPSession(): Promise<RawCdpSession>;
}

export class CdpManager {
    private tabs = new Map<string, BrowserTab>();
    private sessions = new Map<string, CdpSession>();
    private pendingSessions = new Map<string, Promise<CdpSession>>();
    private tabToPageId = new Map<BrowserTab, string>();
    private onCapture?: (tagName: string, preview: string) => void;

    constructor(private output: vscode.OutputChannel) {}

    setOnCapture(cb: (tagName: string, preview: string) => void): void {
        this.onCapture = cb;
    }

    trackTab(pageId: string, tab: BrowserTab): void {
        // If VS Code reused the same tab object under a new pageId (navigation without forceNew),
        // move the existing session to the new pageId rather than creating a second CDP connection.
        const existingPageId = this.tabToPageId.get(tab);
        if (existingPageId && existingPageId !== pageId) {
            this.output.appendLine(`[cdp] tab reused: migrating session from pageId=${existingPageId} → pageId=${pageId}`);
            const session = this.sessions.get(existingPageId);
            if (session) {
                this.sessions.delete(existingPageId);
                this.sessions.set(pageId, session);
            }
            this.tabs.delete(existingPageId);
        }
        this.tabs.set(pageId, tab);
        this.tabToPageId.set(tab, pageId);
        // Pre-establish session so Overlay events are wired before first tool use
        this.ensureSession(pageId).catch(err =>
            this.output.appendLine(`[cdp] proactive session setup failed for pageId=${pageId}: ${err}`)
        );
    }

    removeTab(pageId: string): void {
        const session = this.sessions.get(pageId);
        if (session) {
            session.dispose();
            this.sessions.delete(pageId);
        }
        const tab = this.tabs.get(pageId);
        if (tab) { this.tabToPageId.delete(tab); }
        this.tabs.delete(pageId);
    }

    async ensureSession(pageId: string): Promise<CdpSession> {
        const existing = this.sessions.get(pageId);
        if (existing) { return existing; }
        // Prevent concurrent calls from creating duplicate sessions for the same pageId
        const pending = this.pendingSessions.get(pageId);
        if (pending) { return pending; }
        const tab = this.tabs.get(pageId);
        if (!tab) { throw new Error(`CdpManager: no tab tracked for pageId=${pageId}`); }
        const promise = this.createSession(pageId, tab);
        this.pendingSessions.set(pageId, promise);
        try {
            return await promise;
        } finally {
            this.pendingSessions.delete(pageId);
        }
    }

    private async createSession(pageId: string, tab: BrowserTab): Promise<CdpSession> {
        const raw = await tab.startCDPSession();
        const session = new CdpSession(raw);
        await session.bootstrap();
        this.sessions.set(pageId, session);
        this.output.appendLine(`[cdp] connected to session for pageId=${pageId}`);

        // Enable domains so we receive their events on this session
        try {
            await session.send('DOM.enable');
            await session.send('Overlay.enable');
            await session.send('Page.enable');
            await session.send('Runtime.addBinding', { name: BINDING_NAME });
        } catch (err) {
            this.output.appendLine(`[cdp] domain enable warning for pageId=${pageId}: ${err}`);
        }

        let pickerActive = false;
        const activatePicker = () => {
            if (pickerActive) { return; }
            pickerActive = true;
            void session.send('Overlay.setInspectMode', {
                mode: 'searchForNode',
                highlightConfig: {
                    showInfo: true,
                    contentColor: { r: 0, g: 120, b: 255, a: 0.15 },
                    borderColor: { r: 0, g: 120, b: 255, a: 0.8 },
                },
            }).catch(() => {});
            this.output.appendLine(`[cdp] element picker activated for pageId=${pageId}`);
        };

        const injectButton = () => {
            void session.send('Runtime.evaluate', {
                expression: PICKER_BUTTON_SCRIPT,
                awaitPromise: false,
            }).catch(() => {});
        };

        // Floating "Pick for Agent" button calls window.__mcpPick() → fires this event
        session.onEvent('Runtime.bindingCalled', (params) => {
            if (params['name'] === BINDING_NAME) { activatePicker(); }
        });

        // Re-inject button after each page navigation (load clears the DOM)
        session.onEvent('Page.loadEventFired', () => { injectButton(); });

        // User clicked element after picker activated
        session.onEvent('Overlay.inspectNodeRequested', (params) => {
            const backendNodeId = params['backendNodeId'] as number | undefined;
            if (!backendNodeId) { return; }
            pickerActive = false;
            this.output.appendLine(`[cdp] Overlay.inspectNodeRequested backendNodeId=${backendNodeId} pageId=${pageId}`);
            void session.send('Overlay.setInspectMode', {
                mode: 'none',
                highlightConfig: { showInfo: false, showStyles: false, showRulers: false },
            }).catch(e => { this.output.appendLine(`[cdp] deactivate picker error: ${e}`); });
            void captureNodeByBackendId(session, pageId, backendNodeId, this.output)
                .then(result => { if (result) { this.onCapture?.(result.tagName, result.preview); } });
        });

        // Inject button now (page may already be loaded when session is established)
        injectButton();

        return session;
    }

    get trackedPageIds(): string[] {
        return [...this.tabs.keys()];
    }

    dispose(): void {
        for (const session of this.sessions.values()) { session.dispose(); }
        this.sessions.clear();
        this.tabs.clear();
    }
}
