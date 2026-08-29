/**
 * Skills storage (R18 MUST-lite) — SKILL.md loading + requiredSources.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { LoadedSkill } from './types.ts';
import { parseFrontmatter } from '../sources/storage.ts';
import { missingRequiredSources } from './types.ts';

export { missingRequiredSources } from './types.ts';

export function getSkillsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'skills');
}

/** Load all skills from {workspaceRoot}/skills/{slug}/SKILL.md. */
export function listSkills(workspaceRootPath: string): LoadedSkill[] {
  const root = getSkillsPath(workspaceRootPath);
  if (!existsSync(root)) return [];
  const skills: LoadedSkill[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(root, entry.name);
    const skillFile = join(skillPath, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    try {
      const raw = readFileSync(skillFile, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const name = frontmatter['name'];
      const description = frontmatter['description'];
      if (!name || !description) continue; // SKILL.md must declare both

      skills.push({
        slug: entry.name,
        metadata: {
          name,
          description,
          globs: frontmatter['globs']?.split(',').map((g) => g.trim()).filter(Boolean),
          alwaysAllow: frontmatter['alwaysAllow']?.split(',').map((g) => g.trim()).filter(Boolean),
          requiredSources: frontmatter['requiredSources']?.split(',').map((g) => g.trim()).filter(Boolean),
        },
        content: body,
        path: skillPath,
      });
    } catch {
      // Unreadable skill — skip, don't break listing.
    }
  }

  return skills;
}

/**
 * Load one skill and check its requiredSources against enabled sources.
 * Returns null when the skill exists but its sources are missing.
 */
export function loadSkillIfSourcesReady(
  workspaceRootPath: string,
  slug: string,
  enabledSourceSlugs: string[],
): LoadedSkill | null {
  const skills = listSkills(workspaceRootPath);
  const skill = skills.find((s) => s.slug === slug);
  if (!skill) return null;
  const missing = missingRequiredSources(skill.metadata, enabledSourceSlugs);
  return missing.length > 0 ? null : skill;
}
