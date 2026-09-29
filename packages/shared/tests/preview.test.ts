import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, statSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readFilePreview,
  truncateToValidUtf8,
  MAX_FULL_PREVIEW_BYTES,
  TRUNCATED_PREVIEW_BYTES,
} from '../src/sessions/preview.ts';
import { resolveSessionFilePath } from '../src/sessions/file-path.ts';

describe('readFilePreview', () => {
  it('reads small files completely (<= threshold)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-preview-test-'));
    const file = join(dir, 'small.txt');
    const text = 'Hello, ThreadCove!'.repeat(50);
    writeFileSync(file, text, 'utf-8');

    const result = readFilePreview(file);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
    expect(result.totalBytes).toBe(Buffer.byteLength(text));
    expect(result.previewBytes).toBe(Buffer.byteLength(text));
  });

  it('bounds reading to at most 256KiB for files > 1MiB (> threshold)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-preview-test-'));
    const file = join(dir, 'large.txt');
    const count = 1200; // 1200 KiB > 1024 KiB
    const fd = Buffer.alloc(count * 1024, 65); // All 'A's
    writeFileSync(file, fd);

    const statBefore = statSync(file);
    const result = readFilePreview(file);

    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBe(statBefore.size);
    expect(result.previewBytes).toBe(TRUNCATED_PREVIEW_BYTES);
    expect(result.content.length).toBe(TRUNCATED_PREVIEW_BYTES);
    expect(Buffer.byteLength(result.content, 'utf-8')).toBe(TRUNCATED_PREVIEW_BYTES);
  });

  it('safely truncates multibyte UTF-8 characters without corruption', () => {
    // Chinese character '中' is 3 bytes: 0xE4, 0xB8, 0xAD
    // Emoji '🎉' is 4 bytes: 0xF0, 0x9F, 0x8E, 0x89
    // Let's test truncateToValidUtf8 directly with partial sequences
    const char3 = Buffer.from('中', 'utf-8'); // 3 bytes
    expect(char3.length).toBe(3);

    // Buffer ending with only 1 byte of a 3-byte sequence
    const partial1 = Buffer.concat([Buffer.from('ASCII'), char3.subarray(0, 1)]);
    const fixed1 = truncateToValidUtf8(partial1);
    expect(fixed1.toString('utf-8')).toBe('ASCII');
    expect(fixed1.toString('utf-8').includes('\uFFFD')).toBe(false);

    // Buffer ending with 2 bytes of a 3-byte sequence
    const partial2 = Buffer.concat([Buffer.from('ASCII'), char3.subarray(0, 2)]);
    const fixed2 = truncateToValidUtf8(partial2);
    expect(fixed2.toString('utf-8')).toBe('ASCII');
    expect(fixed2.toString('utf-8').includes('\uFFFD')).toBe(false);

    // Buffer ending with full 3-byte sequence
    const complete3 = Buffer.concat([Buffer.from('ASCII'), char3]);
    const fixed3 = truncateToValidUtf8(complete3);
    expect(fixed3.toString('utf-8')).toBe('ASCII中');

    // Emoji 4-byte partial
    const emoji = Buffer.from('🎉', 'utf-8'); // 4 bytes
    const partialEmoji = Buffer.concat([Buffer.from('Hello'), emoji.subarray(0, 3)]);
    const fixedEmoji = truncateToValidUtf8(partialEmoji);
    expect(fixedEmoji.toString('utf-8')).toBe('Hello');
    expect(fixedEmoji.toString('utf-8').includes('\uFFFD')).toBe(false);

    // File-level test: place a 3-byte character right at 256KiB boundary
    const dir = mkdtempSync(join(tmpdir(), 'tc-preview-test-'));
    const file = join(dir, 'multibyte-boundary.txt');
    // 262143 bytes of 'A', then '中' (3 bytes), followed by padding up to 1.1 MiB
    const prefix = Buffer.alloc(TRUNCATED_PREVIEW_BYTES - 1, 65); // 262143 bytes
    const middle = Buffer.from('中', 'utf-8'); // 3 bytes, starts at byte 262143, ends at 262146
    const rest = Buffer.alloc(MAX_FULL_PREVIEW_BYTES, 66);
    writeFileSync(file, Buffer.concat([prefix, middle, rest]));

    const res = readFilePreview(file);
    expect(res.truncated).toBe(true);
    expect(res.content.includes('\uFFFD')).toBe(false);
    expect(res.previewBytes).toBe(TRUNCATED_PREVIEW_BYTES - 1);
    expect(res.content).toBe(prefix.toString('utf-8'));
  });

  it('rejects directory paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-preview-test-'));
    expect(() => readFilePreview(dir)).toThrow(/regular file/i);
  });

  it('ensures target file is never modified by preview read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-preview-test-'));
    const file = join(dir, 'read-only-test.txt');
    const content = 'UNTOUCHED_CONTENT_TEST_'.repeat(100);
    writeFileSync(file, content, 'utf-8');

    const beforeStat = statSync(file);
    const res = readFilePreview(file);
    const afterStat = statSync(file);

    expect(res.content).toBe(content);
    expect(afterStat.size).toBe(beforeStat.size);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(readFileSync(file, 'utf-8')).toBe(content);
  });

  it('preserves path containment and security via resolveSessionFilePath', () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-containment-test-'));
    const sessionDir = join(root, 'sessions', 'sess-1', 'data');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'artifact.txt'), 'clean artifact');

    // Valid path resolves under data
    const valid = resolveSessionFilePath(root, 'sess-1', 'artifact.txt');
    expect(valid).toBe(join(sessionDir, 'artifact.txt'));

    // Traversal attempts throw
    expect(() => resolveSessionFilePath(root, 'sess-1', '../session.jsonl')).toThrow();
    expect(() => resolveSessionFilePath(root, 'sess-1', '../../secret.txt')).toThrow();
  });
});
