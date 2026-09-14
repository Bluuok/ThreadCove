import { $ } from 'bun';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const cwd = fileURLToPath(new URL('..', import.meta.url));
await $`bun run build`.cwd(cwd);
const require = createRequire(import.meta.url);
const child = spawn(require('electron') as string, ['.'], { cwd, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
