import type * as vscode from 'vscode';

export interface PageInfo { url?: string; openedAt: Date }

export interface ParseContract {
    status: 'ok' | 'diverged' | 'unverified';
    details?: string;
}

export interface ToolContext {
    output: vscode.OutputChannel;
    pages: Map<string, PageInfo>;
    parseContract: ParseContract;
}
