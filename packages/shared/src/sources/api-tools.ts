/**
 * API Tools (R18) — API sources as a single flexible tool.
 *
 * Each API source generates exactly ONE tool, `api_{name}`, whose input is
 * {path, method, params}. Authentication is injected per request. This is
 * the "single flexible tool" pattern: one tool covers the whole API surface
 * without registering one function per endpoint.
 */

import type { ApiCredential } from '../credentials/types.ts';
import { buildAuthorizationHeader } from './server-builder.ts';

export interface ApiToolConfig {
  name: string;
  baseUrl: string;
  auth?: {
    type: 'none' | 'bearer' | 'header' | 'query' | 'basic';
    headerName?: string;
    queryParam?: string;
    authScheme?: string;
  };
  defaultHeaders?: Record<string, string>;
}

/** Tool input schema — one flexible shape for the whole API. */
export interface ApiToolInput {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/** Build the tool name for an API source: api_{name}. */
export function apiToolName(sourceName: string): string {
  return `api_${sourceName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
}

/** Pre-resolve auth (awaits the token getter) before a request. */
export async function prepareAuth(
  config: ApiToolConfig,
  credential: ApiCredential | null | undefined,
  getToken?: () => Promise<string | null>,
): Promise<{ headers: Record<string, string>; queryParams: Record<string, string> }> {
  const headers: Record<string, string> = { ...config.defaultHeaders };
  const queryParams: Record<string, string> = {};

  const authType = config.auth?.type ?? 'none';
  if (authType === 'none') return { headers, queryParams };

  let token: string | null = null;
  if (getToken) {
    token = await getToken();
  } else if (typeof credential === 'string') {
    token = credential;
  }

  if (authType === 'bearer' && token) {
    headers['Authorization'] = buildAuthorizationHeader(config.auth?.authScheme, token);
  } else if (authType === 'header' && token && config.auth?.headerName) {
    headers[config.auth.headerName] = token;
  } else if (authType === 'query' && token && config.auth?.queryParam) {
    queryParams[config.auth.queryParam] = token;
  } else if (authType === 'basic' && credential && typeof credential === 'object' && 'username' in credential) {
    headers['Authorization'] = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
  }

  return { headers, queryParams };
}

/**
 * Create the API tool executor: (input) → HTTP response text.
 * This is what runs behind the single api_{name} tool when the model calls it.
 */
export function createApiToolExecutor(
  config: ApiToolConfig,
  credential: ApiCredential | null,
  getToken?: () => Promise<string | null>,
): (input: ApiToolInput) => Promise<{ content: string; isError: boolean }> {
  return async (input: ApiToolInput) => {
    try {
      const method = input.method ?? 'GET';
      const url = new URL(input.path, config.baseUrl);
      const { headers, queryParams } = await prepareAuth(config, credential, getToken);
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v);
      }
      if (input.params) {
        for (const [k, v] of Object.entries(input.params)) {
          url.searchParams.set(k, String(v));
        }
      }

      const response = await fetch(url, {
        method,
        headers,
        ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      });
      const text = await response.text();
      return { content: text, isError: !response.ok };
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  };
}
