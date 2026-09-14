/**
 * Config package — MODEL_REGISTRY (capability fields) and app paths.
 *
 * Model capability expression (reproduction design decision): a static
 * MODEL_REGISTRY plus optional driver-side dynamic model fetching. The
 * capability surface is intentionally plain data — "configuration marker +
 * runtime capability allowlist" — not a negotiation protocol.
 */

import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// App paths
// ============================================================

/** App data root: ~/.threadcove (override with THREADCOVE_HOME for tests) */
export function getAppRootPath(): string {
  if (process.env['THREADCOVE_HOME']) {
    return process.env['THREADCOVE_HOME'];
  }
  return join(homedir(), '.threadcove');
}

export function getWorkspacesRootPath(): string {
  return join(getAppRootPath(), 'workspaces');
}

export function getConfigFilePath(): string {
  return join(getAppRootPath(), 'config.json');
}

export function getCredentialsFilePath(): string {
  return join(getAppRootPath(), 'credentials.enc');
}

// ============================================================
// Model provider
// ============================================================

/**
 * Provider identifier for AI backends.
 * 'anthropic' → in-process Claude SDK; 'pi' → out-of-process Pi JSONL server;
 * 'deepseek' → in-process OpenAI-compatible streaming client.
 */
export type ModelProvider = 'anthropic' | 'pi' | 'deepseek';

// ============================================================
// Model registry
// ============================================================

/**
 * Model definition with capability fields.
 * The UI/model selectors read from this registry — static capability data,
 * plus driver-side dynamic fetch when a provider supports it.
 */
export interface ModelDefinition {
  /** Model identifier (e.g., 'claude-sonnet-4-6') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider that offers this model */
  provider: ModelProvider;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Whether this model supports thinking/reasoning effort */
  supportsThinking?: boolean;
  /** Whether this model supports image input */
  supportsImages?: boolean;
}

/** Fallback model per provider when nothing is configured. */
export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  pi: 'claude-sonnet-4-6',
  deepseek: 'deepseek-v4-flash',
};

/**
 * Static model registry — single source of truth for model metadata.
 * Extend as needed; drivers may add dynamically-fetched entries at runtime.
 */
export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash · OpenCode Go',
    provider: 'pi',
    contextWindow: 1_000_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Opus 4.8',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    contextWindow: 128_000,
    supportsThinking: true,
  },
];

export function getModelsByProvider(provider: ModelProvider): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider);
}

export function getModelById(modelId: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}

export function isKnownModel(modelId: string): boolean {
  return getModelById(modelId) !== undefined;
}

/** Default context window for models not in the registry. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindowForModel(modelId: string): number {
  return getModelById(modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

// ============================================================
// Thinking levels
// ============================================================

export const THINKING_LEVEL_IDS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ThinkingLevel = (typeof THINKING_LEVEL_IDS)[number];

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

export function normalizeThinkingLevel(value: unknown): ThinkingLevel | null {
  if (typeof value !== 'string') return null;
  return (THINKING_LEVEL_IDS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : null;
}

// ============================================================
// Permission modes
// ============================================================

export type PermissionMode = 'safe' | 'ask' | 'allow-all';

export const PERMISSION_MODE_ORDER: PermissionMode[] = ['safe', 'ask', 'allow-all'];

export function parsePermissionMode(value: unknown): PermissionMode | null {
  if (typeof value !== 'string') return null;
  return (PERMISSION_MODE_ORDER as string[]).includes(value) ? (value as PermissionMode) : null;
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const idx = PERMISSION_MODE_ORDER.indexOf(mode);
  return PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length] ?? 'ask';
}
