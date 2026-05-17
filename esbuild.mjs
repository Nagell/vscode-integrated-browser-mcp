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
});
