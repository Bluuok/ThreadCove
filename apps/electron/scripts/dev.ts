#!/usr/bin/env bun
/**
 * Electron dev launcher.
 * Builds main + preload with esbuild, then starts Electron.
 */

import { $ } from 'bun';
import { spawn } from 'child_process';

console.log('[dev] building main + preload…');
await $`bun run build:main`;
await $`bun run build:preload`;

console.log('[dev] starting electron…');
const electron = spawn('npx', ['electron', '.'], {
  cwd: import.meta.dir + '/..',
  stdio: 'inherit',
  shell: true,
});
electron.on('exit', (code) => process.exit(code ?? 0));
