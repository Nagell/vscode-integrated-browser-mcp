import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: 'out/extension.js',
    external: ['vscode'],
    minify: true,
    // CJS deps (express, MCP SDK) use require() internally; this shim makes
    // those calls work inside the ESM bundle VS Code's extension host loads.
    banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
    }
});
