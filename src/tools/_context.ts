import type * as vscode from 'vscode';

export interface PageInfo { url?: string; openedAt: Date }

export interface ToolContext {
    output: vscode.OutputChannel;
    pages: Map<string, PageInfo>;
}
