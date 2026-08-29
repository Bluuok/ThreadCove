/**
 * Human-Readable Session ID Generator (R08).
 *
 * Format: YYMMDD-adjective-noun (e.g., "260830-swift-river")
 * - Time-sortable by date prefix
 * - Human-readable and memorable
 * - Collision handling with numeric suffix
 */

const ADJECTIVES = [
  'swift', 'quiet', 'bright', 'amber', 'bold', 'calm', 'clear', 'deep',
  'eager', 'fair', 'gentle', 'keen', 'lively', 'misty', 'noble', 'prime',
  'rapid', 'serene', 'sharp', 'tidy', 'vivid', 'warm', 'wise', 'zesty',
] as const;

const NOUNS = [
  'river', 'harbor', 'summit', 'meadow', 'forest', 'canyon', 'island', 'valley',
  'prairie', 'glacier', 'reef', 'dune', 'grove', 'peak', 'spring', 'brook',
  'ridge', 'basin', 'cliff', 'delta', 'field', 'glen', 'hill', 'knoll',
] as const;

/** Date prefix in YYMMDD format. */
export function generateDatePrefix(date: Date = new Date()): string {
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function getRandomElement<T>(array: readonly T[]): T {
  const index = crypto.getRandomValues(new Uint32Array(1))[0]! % array.length;
  return array[index]!;
}

/** Random adjective-noun slug. */
export function generateHumanSlug(): string {
  const adjective = getRandomElement(ADJECTIVES);
  const noun = getRandomElement(NOUNS);
  return `${adjective}-${noun}`;
}

/**
 * Generate a unique session ID, handling collisions with a numeric suffix.
 */
export function generateUniqueSessionId(
  existingIds: Set<string> | string[],
  date: Date = new Date(),
): string {
  const existingSet = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const datePrefix = generateDatePrefix(date);

  for (let attempt = 0; attempt < 100; attempt++) {
    const slug = generateHumanSlug();
    const baseId = `${datePrefix}-${slug}`;
    if (!existingSet.has(baseId)) return baseId;

    // Collision: append attempt number.
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${baseId}-${suffix}`;
      if (!existingSet.has(candidate)) return candidate;
    }
  }

  // Exhausted — fall back to a random suffix.
  const fallback = `${datePrefix}-session-${Math.random().toString(36).slice(2, 8)}`;
  if (!existingSet.has(fallback)) return fallback;
  throw new Error('Could not generate a unique session ID');
}
