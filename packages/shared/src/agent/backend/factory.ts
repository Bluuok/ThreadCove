/**
 * Agent Factory (R03).
 *
 * DRIVER_REGISTRY routes provider → driver; createBackend instantiates the
 * right backend class. Switching backends is a configuration change
 * (BackendConfig.provider), not a code change.
 */

import type {
  AgentBackend,
  BackendConfig,
  BackendFactory,
  ModelProvider,
  ProviderDriver,
} from './types.ts';
import { ClaudeAgent } from '../claude-agent.ts';
import { PiAgent } from '../pi-agent.ts';

// ============================================================
// Provider drivers
// ============================================================

const anthropicDriver: ProviderDriver = {
  provider: 'anthropic',
  buildRuntime(config) {
    return {
      inProcess: true,
      model: config.model,
      cwd: config.workingDirectory,
    };
  },
};

const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime(config) {
    return {
      inProcess: false,
      transport: 'jsonl-stdio',
      model: config.model,
      cwd: config.workingDirectory,
    };
  },
};

export const DRIVER_REGISTRY: Record<ModelProvider, ProviderDriver> = {
  anthropic: anthropicDriver,
  pi: piDriver,
};

const BACKEND_FACTORIES: Record<ModelProvider, BackendFactory> = {
  anthropic: (config) => new ClaudeAgent(config),
  pi: (config) => new PiAgent(config),
};

export function getProviderDriver(provider: ModelProvider): ProviderDriver {
  const driver = DRIVER_REGISTRY[provider];
  if (!driver) {
    throw new Error(`No backend driver registered for provider: ${provider}`);
  }
  return driver;
}

/**
 * Create the appropriate backend based on configuration.
 *
 * @throws Error if the requested provider has no registered driver.
 */
export function createBackend(config: BackendConfig): AgentBackend {
  const factory = BACKEND_FACTORIES[config.provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${config.provider as string}`);
  }
  const driver = getProviderDriver(config.provider);
  // Driver runtime assembly is part of the creation path — the resolved
  // runtime is available to hosts that need it (e.g., for subprocess spawn).
  void driver.buildRuntime(config);
  return factory(config);
}

export { ClaudeAgent, PiAgent };
export type { AgentBackend, BackendConfig };
