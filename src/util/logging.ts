import * as vscode from 'vscode';

/**
 * Diagnostic logging is opt-in for end users: it is always on in the Extension
 * Development Host, and otherwise gated behind the `integratedBrowserMcp.extendedLogging`
 * setting. The setting is read live on every call so toggling it takes effect without a
 * VS Code restart.
 */
export function isExtendedLoggingEnabled(isDev: boolean): boolean {
    if (isDev) { return true; }
    return vscode.workspace.getConfiguration('integratedBrowserMcp').get<boolean>('extendedLogging') ?? false;
}

/** Emits a diagnostic line only when extended logging is enabled. */
export type DebugLogger = (msg: string) => void;

/**
 * Builds a {@link DebugLogger} bound to an output channel. Lines are dropped unless
 * extended logging is enabled (see {@link isExtendedLoggingEnabled}).
 */
export function createDebugLogger(output: vscode.OutputChannel, isDev: boolean): DebugLogger {
    return (msg: string) => {
        if (isExtendedLoggingEnabled(isDev)) { output.appendLine(msg); }
    };
}
