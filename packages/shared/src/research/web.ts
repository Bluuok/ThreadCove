import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseHTML } from 'linkedom';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::',32],['2001:db8::',32],['2002::',16]] as const) blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export async function validatePublicUrl(value: string, resolveHost: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>> = lookup): Promise<{ url: URL; address: string; family: number }> {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public HTTP(S) URLs on standard ports are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost' || /\.(localhost|local|internal)$/i.test(hostname)) throw new Error('Private network access is not allowed');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveHost(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Private or reserved network address is not allowed');
  const chosen = addresses.find(item => item.family === 4) ?? addresses[0]!;
  return { url, ...chosen };
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Resolve every redirect separately and pin the validated DNS address for the actual socket. */
export async function fetchPublicPage(value: string, signal: AbortSignal): Promise<{ url: string; contentType: string; body: string }> {
  let target = value;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  for (let hop = 0; hop <= 3; hop++) {
    deadline.throwIfAborted();
    const resolved = await abortable(validatePublicUrl(target), deadline);
    deadline.throwIfAborted();
    const result = await new Promise<{ redirect?: string; body?: string; contentType?: string }>((resolve, reject) => {
      const request = (resolved.url.protocol === 'https:' ? httpsRequest : httpRequest)(resolved.url, {
        method: 'GET', signal: deadline,
        headers: { 'User-Agent': 'ThreadCove/0.1.0', Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
          else callback(null, resolved.address, resolved.family);
        },
      }, response => {
        const status = response.statusCode ?? 0;
        if ([301,302,303,307,308].includes(status) && response.headers.location) {
          try { resolve({ redirect: new URL(response.headers.location, resolved.url).href }); }
          catch { reject(new Error('Invalid page redirect')); }
          response.destroy(); return;
        }
        const type = response.headers['content-type'] ?? '';
        if (status < 200 || status >= 300) { reject(new Error(`Page returned HTTP ${status}`)); response.destroy(); return; }
        if (!/^(text\/(html|plain)|application\/(xhtml\+xml|json))(;|$)/i.test(type)) { reject(new Error('Unsupported page type; use an HTML or text source')); response.destroy(); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { reject(new Error('Compressed page response is not supported')); response.destroy(); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) { reject(new Error('Page exceeds 2 MB limit')); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), contentType: type }));
      });
      request.on('error', reject); request.end();
    });
    if (result.redirect) { target = result.redirect; continue; }
    return { url: resolved.url.href, contentType: result.contentType!, body: result.body! };
  }
  throw new Error('Too many page redirects');
}

export function extractPage(body: string, contentType: string): { title: string; text: string } {
  if (!/html/i.test(contentType)) return { title: '', text: body.trim().slice(0, 16_000) };
  const { document } = parseHTML(body);
  const title = document.querySelector('title')?.textContent?.trim() ?? '';
  for (const node of document.querySelectorAll('script,style,noscript,iframe,svg,nav,header,footer,form')) node.remove();
  for (const node of document.querySelectorAll('p,div,li,br,h1,h2,h3,h4,section,tr')) node.appendChild(document.createTextNode('\n'));
  const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  const text = (root?.textContent ?? '').replace(/[\t \r]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  return { title: title.slice(0, 300), text: text.slice(0, 16_000) };
}

export function parseSearchResponse(body: string): string {
  const payloads = body.trim().startsWith('{') ? [body] : body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
  for (const payload of payloads) {
    if (!payload || payload === '[DONE]') continue;
    const data = JSON.parse(payload) as { error?: unknown; result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> } };
    if (data.error || data.result?.isError) throw new Error('Search service returned an error; retry later');
    const text = data.result?.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n');
    if (text) return text.slice(0, 16_000);
  }
  throw new Error('Search service returned no results');
}

export async function searchWeb(query: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://mcp.exa.ai/mcp', {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'ThreadCove/0.1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'web_search_exa',
      arguments: { query, type: 'auto', numResults: 5, livecrawl: 'fallback', contextMaxCharacters: 10_000 } } }),
  });
  if (!response.ok) throw new Error(`Search service HTTP ${response.status}${response.status === 429 ? ': anonymous quota reached; retry later or configure another service' : ''}`);
  if (!response.body) throw new Error('Search response has no body');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 512_000) throw new Error('Search response exceeds size limit');
      chunks.push(part.value);
    }
    return parseSearchResponse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function sourceUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"\])]+/g) ?? [])].slice(0, 20);
}
