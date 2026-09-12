import { resolve } from 'node:path';
import { startRuntime } from './runtime.ts';
const runtime = await startRuntime({ root: resolve(process.argv[3] ?? '.threadcove-workspace'), port: Number(process.argv[2]) || 8787,
  token: process.env['THREADCOVE_TOKEN'],
  origins: (process.env['THREADCOVE_WEB_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',') });
console.log(`[threadcove] server ${runtime.url}`);
console.log(`[threadcove] workspace ${runtime.workspaceId}`);
// Explicit local bootstrap link; fragment is not sent to the web server.
console.log(`[threadcove] WebUI: http://localhost:5173/#server=${encodeURIComponent(runtime.url)}&token=${encodeURIComponent(runtime.token)}`);
let closing = false;
async function shutdown() { if (closing) return; closing = true; try { await runtime.close(); process.exitCode = 0; } catch (error) { console.error(error); process.exitCode = 1; } }
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
