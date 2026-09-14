// Actual installed SDK and JSONL server, with transport redirected to a local test fixture.
import { main } from '../../../pi-agent-server/src/index.ts';
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, options?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('https://opencode.ai/zen/go/v1/')) throw new Error('Unexpected test destination');
  return originalFetch(url.replace('https://opencode.ai/zen/go/v1', process.env.THREADCOVE_TEST_API_URL!), options);
}) as typeof fetch;
main();
