import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateCost, formatCostComparison } from '../cost-estimator.js';

describe('estimateTokens', () => {
  it('converts 40000 bytes to 10000 tokens', () => {
    expect(estimateTokens(40000)).toBe(10000);
  });

  it('rounds up for non-divisible sizes', () => {
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(1)).toBe(1);
  });

  it('caps at 50000 tokens per session for large files', () => {
    // 1MB file: raw would be 250000 tokens, but should cap at 50000
    expect(estimateTokens(1_000_000)).toBe(50000);
  });

  it('does not cap small files', () => {
    // 100KB file: raw is 25000, below cap
    expect(estimateTokens(100_000)).toBe(25000);
  });
});

describe('estimateCost', () => {
  const makeSessions = (count: number, size: number) =>
    Array.from({ length: count }, (_, i) => ({ path: `session-${i}.jsonl`, size }));

  it('estimates cost for 10 sessions of 40K bytes with Haiku', () => {
    const sessions = makeSessions(10, 40000);
    const est = estimateCost(sessions, 'anthropic', 'claude-haiku-4-5-20251001');

    expect(est.provider).toBe('anthropic');
    expect(est.model).toBe('claude-haiku-4-5-20251001');
    expect(est.input_tokens).toBe(100000); // 10 * 10000
    // input cost: 100000/1M * 0.80 = $0.08
    // output cost: (2048*10)/1M * 4.00 = $0.08192
    expect(est.estimated_cost_usd).toBeCloseTo(0.08 + 0.08192, 4);
    expect(est.estimated_time_seconds).toBe(50); // 10 * 5
  });

  it('estimates $0 for local provider', () => {
    const sessions = makeSessions(5, 40000);
    const est = estimateCost(sessions, 'local', 'llama3.1:8b');

    expect(est.estimated_cost_usd).toBe(0);
    expect(est.estimated_time_seconds).toBe(500); // 5 * 100
  });

  it('returns $0 and 0 time for 0 sessions', () => {
    const est = estimateCost([], 'anthropic', 'claude-haiku-4-5-20251001');

    expect(est.input_tokens).toBe(0);
    expect(est.estimated_cost_usd).toBe(0);
    expect(est.estimated_time_seconds).toBe(0);
  });

  it('uses default pricing for unknown provider', () => {
    const sessions = makeSessions(1, 4000);
    const est = estimateCost(sessions, 'unknown', 'some-model');

    expect(est.input_tokens).toBe(1000);
    // input: 1000/1M * 0.10 = $0.0001
    // output: 2048/1M * 0.10 = $0.0002048
    expect(est.estimated_cost_usd).toBeCloseTo(0.0001 + 0.0002048, 6);
    expect(est.estimated_time_seconds).toBe(10);
  });
});

describe('formatCostComparison', () => {
  it('shows all 3 providers', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      path: `session-${i}.jsonl`,
      size: 40000,
    }));
    const output = formatCostComparison(sessions);

    expect(output).toContain('Anthropic Haiku');
    expect(output).toContain('OpenRouter Llama');
    expect(output).toContain('Local Ollama');
    expect(output).toContain('free');
    expect(output).toContain('~$');
    expect(output).toContain('Provider');
    expect(output).toContain('Cost');
    expect(output).not.toContain('Time');
  });
});
