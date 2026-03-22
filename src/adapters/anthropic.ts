import Anthropic from '@anthropic-ai/sdk';
import type { LLMAdapter, LLMResponse, CostEstimate } from './types.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    // Check error name/message for rate limit indicators
    if (error.message.includes('rate_limit') || error.message.includes('429')) return true;
    if ('status' in error && (error as any).status === 429) return true;
  }
  // Check Anthropic SDK RateLimitError if available
  try {
    if (Anthropic.RateLimitError && error instanceof Anthropic.RateLimitError) return true;
  } catch {
    // RateLimitError may not exist in mock environments
  }
  return false;
}

function isAuthenticationError(error: unknown): boolean {
  // Check Anthropic SDK AuthenticationError if available
  try {
    if (Anthropic.AuthenticationError && error instanceof Anthropic.AuthenticationError) return true;
  } catch {
    // AuthenticationError may not exist in mock environments
  }
  if (error instanceof Error) {
    if ('status' in error && (error as any).status === 401) return true;
    if (error.name === 'AuthenticationError') return true;
  }
  return false;
}

export class AnthropicAdapter implements LLMAdapter {
  private client: Anthropic;
  readonly name = 'anthropic';

  constructor(apiKey: string, readonly model = 'claude-haiku-4-5-20251001') {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(prompt: string): Promise<LLMResponse> {
    const start = Date.now();
    let lastError: unknown;

    // Split prompt into cacheable system instructions and variable transcript
    const marker = '## Transcript';
    const markerIndex = prompt.indexOf(marker);
    const systemPrompt = markerIndex !== -1 ? prompt.slice(0, markerIndex).trim() : '';
    const userPrompt = markerIndex !== -1 ? prompt.slice(markerIndex) : prompt;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          ...(systemPrompt
            ? {
                system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
                messages: [{ role: 'user' as const, content: userPrompt }],
              }
            : {
                messages: [{ role: 'user' as const, content: prompt }],
              }),
        });
        return {
          content: response.content[0].type === 'text' ? response.content[0].text : '',
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          model: this.model,
          latency_ms: Date.now() - start,
        };
      } catch (error: unknown) {
        lastError = error;

        // Retry on rate limit (429) errors
        if (isRateLimitError(error)) {
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (isAuthenticationError(error)) {
          throw new Error('Invalid Anthropic API key');
        }
        if (
          error instanceof Error &&
          ('code' in error || error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT') || error.message.includes('fetch failed'))
        ) {
          throw new Error(`Network error: ${error.message}`);
        }
        throw error;
      }
    }

    // Should not reach here, but just in case
    throw lastError;
  }

  estimateCost(inputTokens: number): CostEstimate {
    return {
      provider: this.name,
      model: this.model,
      input_tokens: inputTokens,
      estimated_cost_usd: (inputTokens / 1_000_000) * 0.80 + (2048 / 1_000_000) * 4.00,
      estimated_time_seconds: 5,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
