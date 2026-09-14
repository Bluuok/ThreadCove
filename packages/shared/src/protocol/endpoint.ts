export function assertSecureWsUrl(url: string): void {
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid WebSocket URL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'ws:' && !local) throw new Error('Refusing unencrypted ws:// to a remote host; use wss://');
}
