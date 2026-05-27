import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function resolveConfigPath(): string {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude.json');
    }
    const envDir = process.env.CLAUDE_CONFIG_DIR;
    if (envDir) { return path.join(envDir, 'claude.json'); }
    return path.join(os.homedir(), '.claude.json');
}

function safeguardPath(configPath: string, output: vscode.OutputChannel): string | undefined {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(configPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            output.appendLine(`[claudeConfig] cannot stat config path: ${err}`);
            return undefined;
        }
        // Primary file absent — fall back to mcp_settings.json if present
        const fallback = path.join(os.homedir(), '.claude', 'mcp_settings.json');
        try { fs.lstatSync(fallback); return fallback; } catch { /* not present */ }
        return configPath; // will be created fresh
    }

    if (!stat.isSymbolicLink()) { return configPath; }

    let real: string;
    try { real = fs.realpathSync(configPath); } catch (err) {
        output.appendLine(`[claudeConfig] cannot resolve symlink: ${err}`);
        return undefined;
    }
    if (!real.startsWith(os.homedir())) {
        output.appendLine(`[claudeConfig] symlink target outside homedir (${real}), skipping auto-register`);
        return undefined;
    }
    return real;
}

function readWithTimeout(filePath: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`config read timed out after ${timeoutMs}ms`)),
            timeoutMs
        );
        fs.promises.readFile(filePath, 'utf-8').then(
            data => { clearTimeout(timer); resolve(data); },
            err => { clearTimeout(timer); reject(err as Error); }
        );
    });
}

export function alreadyRegistered(config: Record<string, unknown>, mcpUrl: string): boolean {
    const servers = config.mcpServers;
    if (typeof servers !== 'object' || servers === null) { return false; }
    const target = new URL(mcpUrl);
    return Object.values(servers as Record<string, unknown>).some(v => {
        if (typeof v !== 'object' || v === null) { return false; }
        const url = (v as Record<string, unknown>).url;
        if (typeof url !== 'string') { return false; }
        try {
            const u = new URL(url);
            const sameHost = u.hostname === target.hostname ||
                (u.hostname === 'localhost' && target.hostname === '127.0.0.1') ||
                (u.hostname === '127.0.0.1' && target.hostname === 'localhost');
            return sameHost && u.port === target.port && u.pathname === target.pathname;
        } catch { return false; }
    });
}

export function mergeEntry(existing: Record<string, unknown>, mcpUrl: string, serverName = 'integratedBrowser'): Record<string, unknown> {
    const existingServers =
        typeof existing.mcpServers === 'object' && existing.mcpServers !== null
            ? (existing.mcpServers as Record<string, unknown>)
            : {};
    return {
        ...existing,
        mcpServers: { ...existingServers, [serverName]: { type: 'http', url: mcpUrl } }
    };
}

export async function ensureClaudeMcpEntry(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    port: number,
    serverName = 'integratedBrowser'
): Promise<void> {
    if (context.globalState.get('claudeConfig.offered')) { return; }

    const mcpUrl = `http://127.0.0.1:${port}/mcp`;
    const primaryPath = resolveConfigPath();
    const configPath = safeguardPath(primaryPath, output);
    if (!configPath) { return; }

    let existing: Record<string, unknown> = {};
    try {
        const raw = await readWithTimeout(configPath, 5000);
        existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // File absent — proceed with empty config
        } else if (err instanceof SyntaxError) {
            const displayPath = configPath.replace(os.homedir(), '~');
            output.appendLine(`[claudeConfig] malformed JSON: ${err.message}`);
            void vscode.window.showWarningMessage(
                `\`${displayPath}\` couldn't be parsed — skipping auto-register. Fix the file and reload the window to retry.`
            );
            return;
        } else {
            output.appendLine(`[claudeConfig] read failed: ${err}`);
            return;
        }
    }

    if (alreadyRegistered(existing, mcpUrl)) {
        output.appendLine('[claudeConfig] MCP entry already present, skipping prompt');
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        "Integrated Browser MCP isn't yet registered with Claude Code. Add it now?",
        'Add',
        "Don't ask again"
    );

    if (choice !== 'Add') {
        await context.globalState.update('claudeConfig.offered', true);
        return;
    }

    const merged = mergeEntry(existing, mcpUrl, serverName);
    const displayPath = configPath.replace(os.homedir(), '~');
    const tmpPath = `${configPath}.tmp-${process.pid}`;
    try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmpPath, configPath);
        await context.globalState.update('claudeConfig.offered', true);
        output.appendLine(`[claudeConfig] wrote MCP entry to ${configPath}`);
        void vscode.window.showInformationMessage(
            `Added to \`${displayPath}\`. Restart Claude Code to pick up the change.`
        );
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore — tmp may not exist */ }
        output.appendLine(`[claudeConfig] write failed: ${err}`);
        if ((err as NodeJS.ErrnoException).code === 'EACCES') {
            void vscode.window.showErrorMessage(
                `Couldn't write to \`${displayPath}\` (permission denied). Check the file's permissions and reload the window to retry.`
            );
            // Deliberately not setting globalState.offered so the prompt reappears after fixing permissions.
        } else {
            await context.globalState.update('claudeConfig.offered', true);
        }
    }
}
