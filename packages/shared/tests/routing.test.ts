/**
 * R12 routing exhaustiveness test.
 *
 * Every RPC channel must be classified in exactly one of LOCAL_ONLY or
 * REMOTE_ELIGIBLE. A new channel that skips classification fails here —
 * "every channel has been explicitly decided" is enforced by CI, not by
 * reviewer memory.
 */
import { describe, test, expect } from 'bun:test';
import { RPC_CHANNELS } from '../src/protocol/channels.ts';
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '../src/protocol/routing.ts';

function getAllChannelValues(): string[] {
  const values: string[] = [];
  for (const namespace of Object.values(RPC_CHANNELS)) {
    for (const channel of Object.values(namespace)) {
      values.push(channel);
    }
  }
  return values;
}

describe('channel routing exhaustiveness', () => {
  const all = getAllChannelValues();

  test('every channel is classified exactly once', () => {
    for (const ch of all) {
      const inLocal = LOCAL_ONLY_CHANNELS.has(ch);
      const inRemote = REMOTE_ELIGIBLE_CHANNELS.has(ch);

      if (!inLocal && !inRemote) {
        throw new Error(
          `Channel "${ch}" is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE. Add it to one set in routing.ts.`,
        );
      }
      if (inLocal && inRemote) {
        throw new Error(`Channel "${ch}" is in BOTH LOCAL_ONLY and REMOTE_ELIGIBLE. It must be in exactly one.`);
      }
    }
  });

  test('no extra channels in LOCAL_ONLY', () => {
    for (const ch of LOCAL_ONLY_CHANNELS) {
      expect(all).toContain(ch);
    }
  });

  test('no extra channels in REMOTE_ELIGIBLE', () => {
    for (const ch of REMOTE_ELIGIBLE_CHANNELS) {
      expect(all).toContain(ch);
    }
  });

  test('sets are non-empty', () => {
    expect(LOCAL_ONLY_CHANNELS.size).toBeGreaterThan(0);
    expect(REMOTE_ELIGIBLE_CHANNELS.size).toBeGreaterThan(0);
  });

  test('total classified equals total channels', () => {
    expect(LOCAL_ONLY_CHANNELS.size + REMOTE_ELIGIBLE_CHANNELS.size).toBe(all.length);
  });
});

describe('channel routing behavior', () => {
  test('LOCAL_ONLY and REMOTE_ELIGIBLE have zero intersection', () => {
    const intersection: string[] = [];
    for (const ch of LOCAL_ONLY_CHANNELS) {
      if (REMOTE_ELIGIBLE_CHANNELS.has(ch)) {
        intersection.push(ch);
      }
    }
    expect(intersection).toEqual([]);
  });

  test('all session channels are REMOTE_ELIGIBLE (workspace content)', () => {
    const sessionChannels = Object.values(RPC_CHANNELS.sessions);
    expect(sessionChannels.length).toBeGreaterThan(0);
    for (const ch of sessionChannels) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true);
    }
  });

  test('all dialog/system channels are LOCAL_ONLY (need native OS)', () => {
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.dialog.OPEN_FILE)).toBe(true);
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.system.OPEN_EXTERNAL)).toBe(true);
  });
});
