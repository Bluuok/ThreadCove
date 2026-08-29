/**
 * Path portability utilities.
 *
 * Functions for making filesystem paths portable across machines:
 * ~ / ${HOME} expansion on read, ~ prefix on write. Developed on win32 —
 * the Windows backslash cases here are first-hand material, not theory.
 */

import { homedir } from 'os';
import { resolve, join, normalize, isAbsolute } from 'path';

/**
 * Expand path variables (~, ${HOME}, $HOME) to absolute paths.
 *
 * @example
 * expandPath('~')                  // 'C:\Users\alice'
 * expandPath('~/Documents')        // 'C:\Users\alice\Documents'
 * expandPath('~/Documents')        // '/Users/alice/Documents'
 * expandPath('/absolute/path')     // unchanged
 */
export function expandPath(inputPath: string, basePath?: string): string {
  if (!inputPath) return inputPath;

  let expanded = inputPath;
  const home = homedir();

  if (expanded === '~') {
    return home;
  }

  if (expanded.startsWith('~/')) {
    expanded = join(home, expanded.slice(2));
  }

  expanded = expanded.replace(/\$\{HOME\}/g, home);
  expanded = expanded.replace(/\$HOME(?=\/|\\|$)/g, home);

  if (!isAbsolute(expanded)) {
    const base = basePath || process.cwd();
    expanded = resolve(base, expanded);
  }

  return normalize(expanded);
}

/**
 * Convert absolute path to portable form.
 * If path is within the home directory, converts to ~ prefix.
 */
export function toPortablePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;

  const home = homedir();
  const normalized = normalize(absolutePath);

  if (normalized === home) {
    return '~';
  }

  const homePrefix = home + '/';
  const homePrefixWin = home + '\\';

  if (normalized.startsWith(homePrefix)) {
    return '~/' + normalized.slice(homePrefix.length);
  }
  if (normalized.startsWith(homePrefixWin)) {
    return '~/' + normalized.slice(homePrefixWin.length);
  }

  return normalized;
}

/**
 * Normalize a path to forward slashes for consistent cross-platform comparison.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Check if a path is already portable (has ~ prefix or is relative).
 */
export function isPortablePath(path: string): boolean {
  if (!path) return false;
  return path.startsWith('~') || path.startsWith('./') || !isAbsolute(path);
}
