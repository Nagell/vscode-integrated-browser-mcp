import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

export function toWsl(p: string): string {
    return p
        .replace(/^([A-Za-z]):[/\\]/, (_, d: string) => `/mnt/${d.toLowerCase()}/`)
        .replace(/\\/g, '/');
}

// Windows only: returns a Windows UNC path (\\wsl$\<distro>\...) for each
// installed WSL distro. Returns [] when WSL is absent or any call fails.
function wslDistroHomePaths(relative: string): string[] {
    if (process.platform !== 'win32') { return []; }
    try {
        const distros = childProcess.execSync('wsl.exe --list --quiet 2>nul', { timeout: 2000 })
            .toString('utf16le').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const results: string[] = [];
        for (const distro of distros) {
            try {
                const winHome = childProcess.execSync(
                    `wsl.exe -d "${distro}" -- sh -c "wslpath -w ~" 2>nul`,
                    { encoding: 'utf-8', timeout: 2000 }
                ).trim();
                if (winHome) { results.push(path.join(winHome, relative)); }
            } catch { /* distro unavailable */ }
        }
        return results;
    } catch { return []; }
}

export function collectArgvJsonPaths(): string[] {
    const candidates: string[] = [path.join(os.homedir(), '.vscode', 'argv.json')];
    if (process.platform === 'win32') {
        candidates.push(...wslDistroHomePaths(path.join('.vscode', 'argv.json')));
    } else if (process.env.USERPROFILE) {
        // WSL inherits Windows env vars — USERPROFILE carries a Windows-style path
        candidates.push(path.join(toWsl(process.env.USERPROFILE), '.vscode', 'argv.json'));
    } else if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
        candidates.push(path.join(toWsl(`${process.env.HOMEDRIVE}${process.env.HOMEPATH}`), '.vscode', 'argv.json'));
    }
    return [...new Set(candidates)];
}

export function collectClaudeConfigPaths(): string[] {
    if (process.platform === 'win32') {
        const winPath = path.join(
            process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
            'Claude', 'claude.json'
        );
        return [...new Set([winPath, ...wslDistroHomePaths('.claude.json')])];
    }
    const candidates: string[] = [path.join(os.homedir(), '.claude.json')];
    // WSL inherits Windows env vars — APPDATA / USERPROFILE carry Windows-style paths
    const winBase = process.env.APPDATA ??
        (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : undefined);
    if (winBase) {
        candidates.push(path.join(toWsl(winBase), 'Claude', 'claude.json'));
    }
    return [...new Set(candidates)];
}
