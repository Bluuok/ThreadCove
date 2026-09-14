import { describe, expect, test } from 'bun:test';
import { resolveProviderConfig } from '../src/server/runtime.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, loadSession } from '@threadcove/shared/sessions';

describe('provider credential routing', () => {
  test('session upstream survives persistence independently of runtime defaults', async () => {
    const prefix = join(tmpdir(), 'tc-upstream-');
    const root = mkdtempSync(prefix);
    try {
      const session = await createSession(root, { provider: 'pi', apiProvider: 'anthropic', model: 'claude-sonnet-4-6' });
      expect(loadSession(root, session.id)?.apiProvider).toBe('anthropic');
    } finally { if (root.startsWith(prefix)) rmSync(root, { recursive: true, force: true }); }
  });

  test('unknown Pi upstream cannot reuse another provider credential', () => {
    expect(() => resolveProviderConfig({ THREADCOVE_PROVIDER: 'pi', THREADCOVE_PI_PROVIDER: 'openai',
      ANTHROPIC_API_KEY: 'fixture-anthropic' }, () => undefined)).toThrow('Unknown THREADCOVE_PI_PROVIDER');
  });

  test('explicit direct provider does not read an unrelated Go vault', () => {
    const config = resolveProviderConfig({ THREADCOVE_PROVIDER: 'deepseek', THREADCOVE_PI_PROVIDER: 'opencode-go',
      DEEPSEEK_API_KEY: 'fixture-direct' }, () => { throw new Error('Unreadable unrelated vault'); });
    expect(config.apiKey()).toBe('fixture-direct');
  });

  test('restored Pi upstream selects its own credential independently of the current default', () => {
    const config = resolveProviderConfig({ OPENCODE_GO_API_KEY: 'fixture-go', ANTHROPIC_API_KEY: 'fixture-anthropic' });
    expect(config.apiKey('pi', 'anthropic')).toBe('fixture-anthropic');
    expect(config.apiKey('pi', 'opencode-go')).toBe('fixture-go');
    expect(() => config.apiKey('pi', 'unknown')).toThrow('Unknown Pi API provider');
  });

  test('blank environment key falls back to encrypted local configuration', () => {
    const config = resolveProviderConfig({ THREADCOVE_PROVIDER: 'pi', THREADCOVE_PI_PROVIDER: 'opencode-go',
      OPENCODE_GO_API_KEY: '  ' }, () => 'stored-fixture');
    expect(config.apiKey()).toBe('stored-fixture');
    expect(config.model).toBe('deepseek-v4.1-flash');
  });

  test('OpenCode Go selects Pi and the requested model without leaking its key to another backend', () => {
    const config = resolveProviderConfig({ OPENCODE_GO_API_KEY: 'go-fixture' });
    expect(config.provider).toBe('pi');
    expect(config.apiProvider).toBe('opencode-go');
    expect(config.model).toBe('deepseek-v4.1-flash');
    expect(config.apiKey('pi')).toBe('go-fixture');
    expect(config.apiKey('anthropic')).toBeUndefined();
    expect(config.apiKey('deepseek')).toBeUndefined();
  });

  test('explicit fixture backend overrides local default configuration', () => {
    const config = resolveProviderConfig({ THREADCOVE_PROVIDER: 'deepseek', THREADCOVE_MODEL: 'fixture-model',
      DEEPSEEK_API_KEY: 'deepseek-fixture', OPENCODE_GO_API_KEY: 'go-fixture' });
    expect(config.provider).toBe('deepseek');
    expect(config.model).toBe('fixture-model');
    expect(config.apiKey()).toBe('deepseek-fixture');
  });

  test('existing Pi Anthropic configuration keeps its own credentials', () => {
    const config = resolveProviderConfig({ THREADCOVE_PROVIDER: 'pi', ANTHROPIC_API_KEY: 'anthropic-fixture' });
    expect(config.apiProvider).toBe('anthropic');
    expect(config.apiKey()).toBe('anthropic-fixture');
  });
});
