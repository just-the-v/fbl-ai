import type { LLMAdapter, LLMResponse, CostEstimate } from './types.js';

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'local';

  constructor(
    readonly model = 'llama3.1:8b',
    private baseUrl = 'http://localhost:11434'
  ) {}

  async analyze(prompt: string): Promise<LLMResponse> {
    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          format: 'json',
          options: { num_ctx: 32768 },
        }),
      });
    } catch {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) {
        throw new Error(`Model "${this.model}" not found. Install it with: ollama pull ${this.model}`);
      }
      throw new Error(`Ollama error: ${res.status} ${text}`);
    }

    const data = await res.json() as any;
    return {
      content: data.message.content,
      input_tokens: data.prompt_eval_count ?? 0,
      output_tokens: data.eval_count ?? 0,
      model: this.model,
      latency_ms: Date.now() - start,
    };
  }

  estimateCost(inputTokens: number): CostEstimate {
    return {
      provider: this.name,
      model: this.model,
      input_tokens: inputTokens,
      estimated_cost_usd: 0,
      estimated_time_seconds: inputTokens / 500,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch { return false; }
  }
}
