export interface RawCdpSession {
    sendMessage(msg: Record<string, unknown>): Promise<void>;
    onDidReceiveMessage(listener: (msg: Record<string, unknown>) => void): { dispose(): void };
    onDidClose(listener: () => void): { dispose(): void };
    close(): void;
}

export class CdpSession {
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private pageSessionId: string | undefined;
    private msgDisposable: { dispose(): void };
    private closeDisposable: { dispose(): void };
    private closed = false;

    constructor(private raw: RawCdpSession) {
        this.msgDisposable = raw.onDidReceiveMessage(msg => this.onMessage(msg));
        this.closeDisposable = raw.onDidClose(() => this.onClose());
    }

    private onMessage(msg: Record<string, unknown>): void {
        if (msg['id'] === undefined) { return; }
        const p = this.pending.get(msg['id'] as number);
        if (!p) { return; }
        this.pending.delete(msg['id'] as number);
        if (msg['error']) {
            p.reject(new Error((msg['error'] as { message: string }).message));
        } else {
            p.resolve(msg['result']);
        }
    }

    private onClose(): void {
        this.closed = true;
        const err = new Error('CDP session closed');
        for (const p of this.pending.values()) { p.reject(err); }
        this.pending.clear();
    }

    // sessionId === undefined → use pageSessionId; null → root-level (no sessionId in envelope).
    send(method: string, params?: Record<string, unknown>, sessionId?: string | null): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (this.closed) { reject(new Error('CDP session is closed')); return; }
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, 30000);
            this.pending.set(id, {
                resolve: v => { clearTimeout(timer); resolve(v); },
                reject: e => { clearTimeout(timer); reject(e); },
            });
            const envelope: Record<string, unknown> = { id, method };
            if (params) { envelope['params'] = params; }
            const sid = sessionId === undefined ? this.pageSessionId : (sessionId === null ? undefined : sessionId);
            if (sid !== undefined) { envelope['sessionId'] = sid; }
            this.raw.sendMessage(envelope).catch(reject);
        });
    }

    async bootstrap(): Promise<void> {
        const targets = await this.send('Target.getTargets', undefined, null) as {
            targetInfos: Array<{ targetId: string; type: string; url: string }>;
        };
        const page = targets.targetInfos.find(t => t.type === 'page');
        if (!page) { throw new Error('CDP bootstrap: no page target found'); }
        const attach = await this.send('Target.attachToTarget', { targetId: page.targetId, flatten: true }, null) as { sessionId: string };
        this.pageSessionId = attach.sessionId;
    }

    async evaluate(expression: string): Promise<string | undefined> {
        if (!this.pageSessionId) { throw new Error('CdpSession not bootstrapped'); }
        const result = await this.send('Runtime.evaluate', {
            expression: `(async function(){ ${expression} })()`,
            awaitPromise: true,
            returnByValue: true,
        }) as {
            result: { type: string; value?: unknown; description?: string };
            exceptionDetails?: { text: string; exception?: { description?: string } };
        };
        if (result.exceptionDetails) {
            const desc = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
            throw new Error(`CDP evaluate error: ${desc}`);
        }
        if (result.result.value === undefined) { return result.result.description; }
        return String(result.result.value);
    }

    dispose(): void {
        if (this.closed) { return; }
        this.closed = true;
        const err = new Error('CDP session disposed');
        for (const p of this.pending.values()) { p.reject(err); }
        this.pending.clear();
        this.msgDisposable.dispose();
        this.closeDisposable.dispose();
        this.raw.close();
    }
}
