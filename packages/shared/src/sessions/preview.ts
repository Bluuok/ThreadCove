import { openSync, fstatSync, readSync, closeSync } from 'node:fs';

export const MAX_FULL_PREVIEW_BYTES = 1024 * 1024; // 1 MiB
export const TRUNCATED_PREVIEW_BYTES = 256 * 1024; // 256 KiB

export interface FilePreviewResult {
  content: string;
  truncated?: boolean;
  totalBytes: number;
  previewBytes: number;
}

/**
 * Truncates a buffer to end at a valid UTF-8 character boundary.
 * Prevents mangled replacement characters (\uFFFD) when slicing multibyte sequences.
 */
export function truncateToValidUtf8(buf: Buffer): Buffer {
  const len = buf.length;
  if (len === 0) return buf;

  let i = len - 1;
  let continuations = 0;
  while (i >= 0 && i >= len - 4) {
    const byte = buf[i]!;
    if ((byte & 0x80) === 0) {
      // ASCII byte, sequence complete
      break;
    }
    if ((byte & 0xc0) === 0x80) {
      // Continuation byte (10xxxxxx)
      continuations++;
      i--;
      continue;
    }
    // Found leading byte
    let expected = 0;
    if ((byte & 0xe0) === 0xc0) expected = 1;
    else if ((byte & 0xf0) === 0xe0) expected = 2;
    else if ((byte & 0xf8) === 0xf0) expected = 3;

    if (expected > 0 && continuations < expected) {
      // Incomplete trailing sequence: strip lead byte and trailing continuation bytes
      return buf.subarray(0, i);
    }
    // Complete sequence
    return buf;
  }

  // Trailing orphan continuation bytes without a leading byte
  if (continuations > 0 && i < len - continuations) {
    return buf.subarray(0, len - continuations);
  }

  return buf;
}

/**
 * Reads a bounded file preview using a single opened file descriptor.
 * - Rejects non-regular files
 * - Bounded reading: <= 1 MiB full read, > 1 MiB reads at most 256 KiB
 * - UTF-8 character truncation never forges or mangles trailing bytes
 */
export function readFilePreview(filePath: string): FilePreviewResult {
  const fd = openSync(filePath, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
    const totalBytes = stat.size;
    const isTruncated = totalBytes > MAX_FULL_PREVIEW_BYTES;
    const maxToRead = isTruncated ? TRUNCATED_PREVIEW_BYTES : Math.min(totalBytes, MAX_FULL_PREVIEW_BYTES);

    const buf = Buffer.alloc(maxToRead);
    let bytesRead = 0;
    if (maxToRead > 0) {
      bytesRead = readSync(fd, buf, 0, maxToRead, 0);
    }

    const rawSlice = buf.subarray(0, bytesRead);
    const validSlice = isTruncated ? truncateToValidUtf8(rawSlice) : rawSlice;

    return {
      content: validSlice.toString('utf-8'),
      truncated: isTruncated,
      totalBytes,
      previewBytes: validSlice.length,
    };
  } finally {
    closeSync(fd);
  }
}
