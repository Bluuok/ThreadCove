/**
 * R18 tests — credential storage, header precedence, Authorization three
 * modes, server-builder null contracts, proxy tool naming, skills.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  SecureStorageBackend,
  credentialIdToAccount,
  accountToCredentialId,
  isMultiHeaderCredential,
} from '../src/credentials/index.ts';
import {
  SourceServerBuilder,
  buildAuthorizationHeader,
  normalizeMcpUrl,
  SERVER_BUILD_ERRORS,
} from '../src/sources/server-builder.ts';
import { createSource, loadSource, deleteSource, listSources, SourceCredentialManager } from '../src/sources/storage.ts';
import { apiToolName, createApiToolExecutor, prepareAuth } from '../src/sources/api-tools.ts';
import { proxyToolName, McpClientPool } from '../src/mcp/mcp-pool.ts';
import { listSkills, missingRequiredSources } from '../src/skills/index.ts';
import { createWorkspace } from '../src/workspaces/storage.ts';
import type { LoadedSource } from '../src/sources/types.ts';

// ============================================================
// Credential storage
// ============================================================

describe('SecureStorageBackend (AES-256-GCM, machine-bound)', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'tc-r18-cred-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function makeBackend(machineId: string): SecureStorageBackend {
    return new SecureStorageBackend({
      filePath: join(base, 'credentials.enc'),
      machineId: () => machineId,
      iterations: 1000, // small for test speed
    });
  }

  test('set/get roundtrip', () => {
    const backend = makeBackend('machine-A');
    backend.setCredential('source_token::ws1::linear', 'secret-token-123');
    expect(backend.getCredential('source_token::ws1::linear')).toBe('secret-token-123');
  });

  test('encrypted at rest: file does not contain plaintext', () => {
    const backend = makeBackend('machine-A');
    backend.setCredential('source_token::ws1::linear', 'SUPER-SECRET-PLAINTEXT');
    const raw = readFileSync(join(base, 'credentials.enc'));
    expect(raw.toString('utf-8')).not.toContain('SUPER-SECRET-PLAINTEXT');
  });

  test('machine change: same file, different machine ID → decryption fails (null)', () => {
    const backendA = makeBackend('machine-A');
    backendA.setCredential('source_token::ws1::linear', 'portable?no');
    expect(existsSync(join(base, 'credentials.enc'))).toBe(true);

    // "Copy the file to another machine": new backend, same file, new ID.
    const backendB = makeBackend('machine-B');
    const loaded = backendB.load();
    expect(loaded).toBeNull();
    expect(backendB.getCredential('source_token::ws1::linear')).toBeNull();
  });

  test('64-byte header with magic + salt', () => {
    const backend = makeBackend('machine-A');
    backend.setCredential('k', 'v');
    const raw = readFileSync(join(base, 'credentials.enc'));
    expect(raw.length).toBeGreaterThanOrEqual(64);
    expect(raw.subarray(0, 4).toString('utf-8')).toBe('TC01');
  });

  test('delete removes credential', () => {
    const backend = makeBackend('machine-A');
    backend.setCredential('a', '1');
    expect(backend.deleteCredential('a')).toBe(true);
    expect(backend.getCredential('a')).toBeNull();
    expect(backend.deleteCredential('a')).toBe(false);
  });

  test('credential id/account mapping roundtrip', () => {
    const id = { kind: 'source_token' as const, workspaceId: 'ws-9', sourceSlug: 'arxiv' };
    const account = credentialIdToAccount(id);
    expect(accountToCredentialId(account)).toEqual(id);
    expect(accountToCredentialId('garbage')).toBeNull();
  });
});

// ============================================================
// Header precedence + server builder
// ============================================================

function makeMcpSource(overrides: Record<string, unknown> = {}): LoadedSource {
  return {
    config: {
      slug: 'linear',
      name: 'Linear',
      provider: 'linear',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://mcp.linear.app/mcp',
        authType: 'bearer',
        headers: { 'X-Custom-Header': 'static-value' },
        ...overrides,
      },
      isAuthenticated: true,
      ...(overrides.config ?? {}),
    } as LoadedSource['config'],
    guide: null,
    folderPath: '/tmp/sources/linear',
    workspaceRootPath: '/tmp/ws',
  };
}

describe('SourceServerBuilder — three-layer header precedence', () => {
  const builder = new SourceServerBuilder();

  test('layer 3 wins: bearer token overrides credential headers overrides static', () => {
    const source = makeMcpSource();
    const config = builder.buildMcpServer(
      source,
      'bearer-token-1',
      { 'X-API-Key': 'cred-key', Authorization: 'Bearer stale' },
    );
    expect(config).not.toBeNull();
    expect(config?.type).toBe('http');
    expect((config as { headers: Record<string, string> }).headers).toEqual({
      'X-Custom-Header': 'static-value',
      'X-API-Key': 'cred-key',
      Authorization: 'Bearer bearer-token-1',
    });
  });

  test('no bearer token: credential headers survive, static headers preserved', () => {
    const source = makeMcpSource({ authType: 'none' });
    const config = builder.buildMcpServer(source, null, { 'X-API-Key': 'cred-key' });
    expect((config as { headers: Record<string, string> }).headers).toEqual({
      'X-Custom-Header': 'static-value',
      'X-API-Key': 'cred-key',
    });
  });

  test('missing token while isAuthenticated → null (needs re-auth)', () => {
    const source = makeMcpSource();
    const config = builder.buildMcpServer(source, null, null);
    expect(config).toBeNull();
  });

  test('missing token while NOT authenticated → builds without auth header', () => {
    const source = makeMcpSource({ authType: 'none', headers: undefined, isAuthenticated: false });
    (source.config as { isAuthenticated: boolean }).isAuthenticated = false;
    const config = builder.buildMcpServer(source, null, null);
    expect(config).not.toBeNull();
    expect((config as { headers?: Record<string, string> }).headers).toBeUndefined();
  });

  test('stdio config missing command → null', () => {
    const source = makeMcpSource({ transport: 'stdio', command: undefined });
    (source.config.mcp as { transport: string }).transport = 'stdio';
    const config = builder.buildMcpServer(source, null, null);
    expect(config).toBeNull();
  });

  test('stdio config with command builds stdio server', () => {
    const source = makeMcpSource({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'] });
    (source.config.mcp as { transport: string }).transport = 'stdio';
    const config = builder.buildMcpServer(source, null, null);
    expect(config?.type).toBe('stdio');
    expect((config as { command: string }).command).toBe('npx');
  });

  test('buildAllMcpServers collects errors with standard messages', () => {
    const good = makeMcpSource();
    (good.config as { slug: string }).slug = 'good';
    const bad = makeMcpSource();
    (bad.config as { slug: string }).slug = 'bad';

    const result = builder.buildAllMcpServers([
      { source: good, token: 'tok' },
      { source: bad, token: null },
    ]);
    expect(result.mcpServers['good']).toBeDefined();
    expect(result.errors).toEqual([{ sourceSlug: 'bad', error: SERVER_BUILD_ERRORS.AUTH_REQUIRED }]);
  });
});

describe('buildAuthorizationHeader — three modes', () => {
  test('default Bearer', () => {
    expect(buildAuthorizationHeader(undefined, 'tok123')).toBe('Bearer tok123');
  });
  test('custom scheme (Token)', () => {
    expect(buildAuthorizationHeader('Token', 'tok123')).toBe('Token tok123');
  });
  test('empty scheme → bare token', () => {
    expect(buildAuthorizationHeader('', 'tok123')).toBe('tok123');
  });
});

describe('normalizeMcpUrl', () => {
  test('adds /mcp path to bare host', () => {
    expect(normalizeMcpUrl('https://mcp.example.com')).toBe('https://mcp.example.com/mcp');
  });
  test('keeps existing path', () => {
    expect(normalizeMcpUrl('https://mcp.example.com/sse')).toBe('https://mcp.example.com/sse');
  });
});

// ============================================================
// API tools
// ============================================================

describe('API single flexible tool', () => {
  test('apiToolName sanitizes', () => {
    expect(apiToolName('ArXiv Search')).toBe('api_arxiv_search');
  });

  test('prepareAuth bearer / header / query / none', async () => {
    const bearer = await prepareAuth(
      { name: 'x', baseUrl: 'https://api.test', auth: { type: 'bearer' } },
      'tok',
    );
    expect(bearer.headers['Authorization']).toBe('Bearer tok');

    const headerAuth = await prepareAuth(
      { name: 'x', baseUrl: 'https://api.test', auth: { type: 'header', headerName: 'X-API-Key' } },
      'tok',
    );
    expect(headerAuth.headers['X-API-Key']).toBe('tok');

    const queryAuth = await prepareAuth(
      { name: 'x', baseUrl: 'https://api.test', auth: { type: 'query', queryParam: 'api_key' } },
      'tok',
    );
    expect(queryAuth.queryParams['api_key']).toBe('tok');

    const none = await prepareAuth(
      { name: 'x', baseUrl: 'https://api.test', auth: { type: 'none' } },
      'tok',
    );
    expect(none.headers['Authorization']).toBeUndefined();
  });

  test('getToken hook overrides static credential per request', async () => {
    const { headers } = await prepareAuth(
      { name: 'x', baseUrl: 'https://api.test', auth: { type: 'bearer' } },
      'static-token',
      async () => 'fresh-token',
    );
    expect(headers['Authorization']).toBe('Bearer fresh-token');
  });

  test('executor injects auth and reports HTTP errors', async () => {
    // Local test server via Bun.serve
    let receivedAuth = '';
    let receivedQuery = '';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        receivedAuth = req.headers.get('authorization') ?? '';
        receivedQuery = url.searchParams.get('q') ?? '';
        if (url.pathname === '/fail') return new Response('nope', { status: 500 });
        return Response.json({ ok: true, path: url.pathname });
      },
    });
    try {
      const executor = createApiToolExecutor(
        { name: 'test', baseUrl: `http://localhost:${server.port}`, auth: { type: 'bearer' } },
        'secret-token',
      );
      const result = await executor({ path: '/search', params: { q: 'papers' } });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content).ok).toBe(true);
      expect(receivedAuth).toBe('Bearer secret-token');
      expect(receivedQuery).toBe('papers');

      const failed = await executor({ path: '/fail' });
      expect(failed.isError).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

// ============================================================
// MCP pool proxy naming
// ============================================================

describe('MCP proxy tool naming', () => {
  test('proxyToolName sanitizes disallowed characters', () => {
    expect(proxyToolName('linear', 'createIssue')).toBe('mcp__linear__createIssue');
    expect(proxyToolName('pat', 'batch.plan')).toBe('mcp__pat__batch_plan');
  });

  test('pool resolve/callTool dispatch on proxy names (in-memory mapping)', async () => {
    const pool = new McpClientPool();
    // Simulate registration by testing the mapping contract through
    // resolveProxyTool after manually inserting — the real connect path
    // is exercised in the manual smoke test with a stdio server.
    (pool as unknown as { proxyTools: Map<string, { slug: string; originalName: string }> }).proxyTools.set(
      'mcp__linear__create_issue',
      { slug: 'linear', originalName: 'create_issue' },
    );
    expect(pool.resolveProxyTool('mcp__linear__create_issue')).toEqual({
      slug: 'linear',
      originalName: 'create_issue',
    });
    expect(pool.resolveProxyTool('mcp__linear__createIssue')).toBeNull();

    const result = await pool.callTool('mcp__missing__tool', {});
    expect(result.isError).toBe(true);
  });
});

// ============================================================
// Source CRUD + credentials integration
// ============================================================

describe('Source storage + credential manager', () => {
  let workspaceRoot: string;
  let backend: SecureStorageBackend;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'tc-r18-src-'));
    process.env['THREADCOVE_HOME'] = base;
    const ws = createWorkspace({ name: 'R18' });
    workspaceRoot = ws.rootPath;
    backend = new SecureStorageBackend({
      filePath: join(base, 'credentials.enc'),
      machineId: () => 'test-machine',
      iterations: 1000,
    });
  });

  afterEach(() => {
    rmSync(process.env['THREADCOVE_HOME']!, { recursive: true, force: true });
    delete process.env['THREADCOVE_HOME'];
  });

  test('create/load/delete source folder', () => {
    createSource(workspaceRoot, {
      slug: 'arxiv',
      name: 'arXiv',
      provider: 'arxiv',
      type: 'api',
      api: { baseUrl: 'https://export.arxiv.org/api', authType: 'none' },
    }, '---\nusage: query papers\n---\nSearch arXiv with path=/api/query');

    const loaded = loadSource(workspaceRoot, 'arxiv');
    expect(loaded?.config.name).toBe('arXiv');
    expect(loaded?.guide?.cache?.['usage']).toBe('query papers');
    expect(listSources(workspaceRoot)).toHaveLength(1);

    expect(deleteSource(workspaceRoot, 'arxiv')).toBe(true);
    expect(loadSource(workspaceRoot, 'arxiv')).toBeNull();
  });

  test('credential manager stores token per source in the vault', () => {
    const manager = new SourceCredentialManager(backend, 'ws-1');
    manager.setToken('linear', 'tok-abc');
    expect(manager.getToken('linear')).toBe('tok-abc');
    expect(manager.getToken('other')).toBeNull();
    manager.removeCredential('linear');
    expect(manager.getToken('linear')).toBeNull();
  });
});

// ============================================================
// Skills
// ============================================================

describe('Skills — SKILL.md + requiredSources', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'tc-r18-skill-'));
    process.env['THREADCOVE_HOME'] = base;
    const ws = createWorkspace({ name: 'Skills' });
    workspaceRoot = ws.rootPath;

    mkdirSync(join(workspaceRoot, 'skills', 'paper-review'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'skills', 'paper-review', 'SKILL.md'),
      `---
name: Paper Review
description: Review an academic paper against the field's standards
requiredSources: arxiv, semantic-scholar
alwaysAllow: WebSearch
---
Read the paper, then compare it against related work using the sources.`,
      'utf-8',
    );
    mkdirSync(join(workspaceRoot, 'skills', 'plain-notes'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'skills', 'plain-notes', 'SKILL.md'),
      `---
name: Plain Notes
description: Summarize notes without any sources
---
Summarize the given notes.`,
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(process.env['THREADCOVE_HOME']!, { recursive: true, force: true });
    delete process.env['THREADCOVE_HOME'];
  });

  test('listSkills parses frontmatter including requiredSources', () => {
    const skills = listSkills(workspaceRoot);
    expect(skills).toHaveLength(2);
    const review = skills.find((s) => s.slug === 'paper-review')!;
    expect(review.metadata.name).toBe('Paper Review');
    expect(review.metadata.requiredSources).toEqual(['arxiv', 'semantic-scholar']);
    expect(review.metadata.alwaysAllow).toEqual(['WebSearch']);
  });

  test('missingRequiredSources reports unsatisfied sources', () => {
    expect(missingRequiredSources({ name: 'x', description: 'x', requiredSources: ['arxiv'] }, ['arxiv'])).toEqual([]);
    expect(missingRequiredSources({ name: 'x', description: 'x', requiredSources: ['arxiv', 'web'] }, ['arxiv'])).toEqual(['web']);
  });
});

// isMultiHeaderCredential type guard
describe('credential type guard', () => {
  test('distinguishes multi-header from plain token', () => {
    expect(isMultiHeaderCredential({ 'X-API-Key': 'a' })).toBe(true);
    expect(isMultiHeaderCredential('plain-token')).toBe(false);
    expect(isMultiHeaderCredential({ username: 'u', password: 'p' })).toBe(false);
    expect(isMultiHeaderCredential(null)).toBe(false);
  });
});
