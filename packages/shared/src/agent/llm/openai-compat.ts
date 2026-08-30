/**
 * OpenAI-compatible streaming chat client (DeepSeek).
 *
 * Minimal SSE client over the /chat/completions endpoint. Used by the
 * DeepSeek backend and by Pi subprocess flows that need direct LLM
 * queries. Kept dependency-free: fetch + manual SSE line parsing.
 *
 * Response shape notes (verified against api.deepseek.com):
 * - stream: true → SSE lines "data: {...}"; [DONE] terminates
 * - deltas carry `reasoning_content` (thinking) and/or `content`
 * - final usage arrives on the last chunk when stream_options
 *   include_usage is set
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  /** Called per content delta (visible answer text). */
  onTextDelta?: (text: string) => void;
  /** Called per reasoning delta (thinking tokens). */
  onReasoningDelta?: (text: string) => void;
}

export interface ChatCompletionResult {
  content: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string | null;
}

export interface OpenAICompatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

export class OpenAICompatClient {
  constructor(private readonly options: OpenAICompatOptions) {}

  /** Non-streaming completion (mini completions, titles). */
  async complete(messages: ChatMessage[], maxTokens?: number): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.options.model, messages, max_tokens: maxTokens }),
      signal: this.options.signal,
    });
    if (!response.ok) {
      throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string }; finish_reason: string | null }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = data.choices[0];
    return {
      content: choice?.message?.content ?? '',
      reasoning: choice?.message?.reasoning_content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      finishReason: choice?.finish_reason,
    };
  }

  /**
   * Streaming completion. Returns the full result while invoking
   * callbacks per delta.
   */
  async stream(messages: ChatMessage[], callbacks: StreamCallbacks): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: this.options.signal,
    });
    if (!response.ok) {
      throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    if (!response.body) throw new Error('No response body');

    let content = '';
    let reasoning = '';
    let usage: ChatCompletionResult['usage'];
    let finishReason: string | null = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by \n\n (or \r\n\r\n).
      let frameEnd: number;
      while ((frameEnd = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + (buffer[frameEnd] === '\r' ? 4 : 2));

        const dataLine = frame
          .split(/\r?\n/)
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
          };
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            reasoning += delta.reasoning_content;
            callbacks.onReasoningDelta?.(delta.reasoning_content);
          }
          if (delta?.content) {
            content += delta.content;
            callbacks.onTextDelta?.(delta.content);
          }
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            };
          }
        } catch {
          // Malformed chunk — skip, keep the stream alive.
        }
      }
    }

    return { content, reasoning: reasoning || undefined, usage, finishReason };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}
