/**
 * Skill types (R18 MUST-lite).
 *
 * Skill = SKILL.md with YAML frontmatter. Sources manage connections/
 * credentials/config; Skills manage usage logic — the separation is the
 * code-level anchor for "Source × Skill 分离".
 */

export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /** Optional source slugs that must be active for this skill */
  requiredSources?: string[];
}

/** A loaded skill with parsed content. */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to skill directory */
  path: string;
}

/**
 * Validate that a skill's requiredSources are satisfied by the enabled
 * source slugs. Returns the list of missing slugs (empty = satisfied).
 */
export function missingRequiredSources(
  skill: SkillMetadata,
  enabledSourceSlugs: string[],
): string[] {
  const enabled = new Set(enabledSourceSlugs);
  return (skill.requiredSources ?? []).filter((slug) => !enabled.has(slug));
}
