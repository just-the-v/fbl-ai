import type { CostEstimate } from '../adapters/types.js';

interface SessionFile {
  path: string;
  size: number; // bytes
}

const PRICING: Record<string, { input: number; output: number; time_per_session: number }> = {
  'anthropic:claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, time_per_session: 5 },
  'anthropic:claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00, time_per_session: 8 },
  'openrouter:meta-llama/llama-3.1-8b-instruct': { input: 0.06, output: 0.06, time_per_session: 8 },
  'local:llama3.1:8b': { input: 0, output: 0, time_per_session: 100 },
};

export function estimateTokens(fileSize: number): number {
  // The parser truncates each message to 500 chars, and the prompt builder
  // has a max token budget (default 190K). Raw file size overestimates by ~10-20x.
  // Heuristic: estimate ~5K-15K tokens per session after truncation.
  // Better estimate: cap at 50K tokens per session (prompt budget / 4 for safety)
  const rawEstimate = Math.ceil(fileSize / 4);
  const maxPerSession = 50000; // After truncation + prompt overhead
  return Math.min(rawEstimate, maxPerSession);
}

export function estimateCost(
  sessions: SessionFile[],
  providerType: string,
  model: string
): CostEstimate {
  const key = `${providerType}:${model}`;
  const pricing = PRICING[key] ?? { input: 0.10, output: 0.10, time_per_session: 10 };

  const totalTokens = sessions.reduce((sum, s) => sum + estimateTokens(s.size), 0);
  const outputTokensEstimate = 2048 * sessions.length;

  return {
    provider: providerType,
    model,
    input_tokens: totalTokens,
    estimated_cost_usd:
      (totalTokens / 1_000_000) * pricing.input +
      (outputTokensEstimate / 1_000_000) * pricing.output,
    estimated_time_seconds: sessions.length * pricing.time_per_session,
  };
}

export function formatCostComparison(sessions: SessionFile[]): string {
  const providers = [
    { type: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Anthropic Haiku' },
    { type: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct', label: 'OpenRouter Llama' },
    { type: 'local', model: 'llama3.1:8b', label: 'Local Ollama' },
  ];

  const lines = providers.map(p => {
    const est = estimateCost(sessions, p.type, p.model);
    const cost = est.estimated_cost_usd === 0 ? 'free' : `~$${est.estimated_cost_usd.toFixed(2)}`;
    return `  ${p.label.padEnd(22)} ${cost}`;
  });

  return `Estimated cost:\n  ${'Provider'.padEnd(22)} Cost\n${lines.join('\n')}`;
}
