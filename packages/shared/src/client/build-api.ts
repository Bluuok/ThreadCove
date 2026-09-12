/**
 * Build the client API proxy.
 *
 * Replaces a hand-written preload bridge: the ElectronAPI TypeScript
 * interface enforces types at compile time, this proxy provides runtime
 * dispatch. Dotted keys become nested namespaces.
 */

import type { RpcClient } from '@threadcove/shared/protocol';
import type { ElectronAPI } from './types.ts';

// ---------------------------------------------------------------------------
// Channel map entry
// ---------------------------------------------------------------------------

export type ChannelMapEntry =
  | { type: 'invoke'; channel: string; transform?: (result: unknown) => unknown }
  | { type: 'listener'; channel: string };

export type ChannelMap = Record<string, ChannelMapEntry>;

// ---------------------------------------------------------------------------
// Proxy builder
// ---------------------------------------------------------------------------

export function buildClientApi(
  client: RpcClient,
  channelMap: ChannelMap,
  isChannelAvailable?: (channel: string) => boolean,
): ElectronAPI {
  const api: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = {};

  for (const [key, entry] of Object.entries(channelMap) as Array<[string, ChannelMapEntry]>) {
    let fn: (...args: unknown[]) => unknown;
    if (entry.type === 'listener') {
      // Listener registration returns an unsubscribe function.
      fn = ((cb: (...args: unknown[]) => void) => {
        const un = client.on(entry.channel, cb as (first: unknown, ...rest: unknown[]) => void);
        return un;
      }) as unknown as (...args: unknown[]) => unknown;
    } else if (entry.transform) {
      const t = entry.transform;
      fn = async (...args: unknown[]) => t(await client.invoke(entry.channel, ...args));
    } else {
      fn = (...args: unknown[]) => client.invoke(entry.channel, ...args);
    }

    // Dotted keys like "session.send" become nested: api.session.send
    const dotIdx = key.indexOf('.');
    if (dotIdx !== -1) {
      const ns = key.slice(0, dotIdx);
      const method = key.slice(dotIdx + 1);
      if (!nested[ns]) nested[ns] = {};
      nested[ns][method] = fn;
    } else {
      api[key] = fn;
    }
  }

  for (const [ns, methods] of Object.entries(nested)) {
    api[ns] = methods;
  }

  // Expose channel availability check for GUI-aware code. When a map
  // check is provided, dotted keys resolve via their namespace root.
  api.isChannelAvailable =
    isChannelAvailable ??
    ((channel?: string) => {
      if (!channel) return true;
      if (channel in channelMap) return true;
      const root = channel.split('.')[0] ?? '';
      return root in channelMap;
    });

  return api as unknown as ElectronAPI;
}
