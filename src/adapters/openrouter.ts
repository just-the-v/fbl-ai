import type { LLMAdapter, LLMResponse, CostEstimate } from './types.js';

const OPENROUTER_PRICING: Record<string, { input: number; output: number }> = {
  'meta-llama/llama-3.1-8b-instruct': { input: 0.06, output: 0.06 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.35, output: 0.40 },
  'mistralai/mistral-7b-instruct': { input: 0.06, output: 0.06 },
  'google/gemini-flash-1.5': { input: 0.075, output: 0.30 },
};

export class OpenRouterAdapter implements LLMAdapter {
  readonly name = 'openrouter';

  constructor(
    private apiKey: string,
    readonly model = 'meta-llama/llama-3.1-8b-instruct'
  ) {}

  async analyze(prompt: string): Promise<LLMResponse> {
    const start = Date.now();
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'fbl',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Invalid OpenRouter API key');
      if (res.status === 404) throw new Error(`Model not found: ${this.model}`);
      throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as any;
    return {
      content: data.choices[0].message.content,
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      model: this.model,
      latency_ms: Date.now() - start,
    };
  }

  estimateCost(inputTokens: number): CostEstimate {
    const pricing = OPENROUTER_PRICING[this.model] ?? { input: 0.10, output: 0.10 };
    return {
      provider: this.name,
      model: this.model,
      input_tokens: inputTokens,
      estimated_cost_usd: (inputTokens / 1_000_000) * pricing.input + (2048 / 1_000_000) * pricing.output,
      estimated_time_seconds: 8,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch { return false; }
  }
}
