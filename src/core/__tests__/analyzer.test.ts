import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { analyzeSession, type AnalyzeOptions } from '../analyzer.js';
import type { LLMAdapter, LLMResponse, CostEstimate } from '../../adapters/types.js';
import type { Config } from '../../storage/config.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const normalSessionPath = join(fixturesDir, 'normal-session.jsonl');
const shortSessionPath = join(fixturesDir, 'short-session.jsonl');

function makeValidLLMJson() {
  return JSON.stringify({
    frictions: [
      {
        type: 'wrong_approach',
        category: 'refactoring',
        severity: 'low',
        description: 'Initial approach was monolithic',
        count: 1,
      },
    ],
    suggestions: [
      {
        target: 'claude_md',
        scope: 'project',
        rule: 'Always split large functions into smaller units before refactoring',
        confidence: 'high',
        reasoning: 'Reduces cognitive load during review',
        friction_types: ['wrong_approach'],
      },
    ],
    satisfaction: {
      positive_signals: 2,
      negative_signals: 0,
    },
    summary: 'User asked for auth module refactoring. Assistant split login into authenticate and authorize.',
  });
}

function createMockAdapter(responseContent: string | (() => string)): LLMAdapter {
  const analyzeFn = vi.fn(async (_prompt: string): Promise<LLMResponse> => ({
    content: typeof responseContent === 'function' ? responseContent() : responseContent,
    input_tokens: 1000,
    output_tokens: 500,
    model: 'claude-sonnet-4-20250514',
    latency_ms: 1200,
  }));

  return {
    name: 'mock',
    model: 'claude-sonnet-4-20250514',
    analyze: analyzeFn,
    estimateCost(_inputTokens: number): CostEstimate {
      return {
        provider: 'mock',
        model: 'claude-sonnet-4-20250514',
        input_tokens: _inputTokens,
        estimated_cost_usd: 0,
        estimated_time_seconds: 1,
      };
    },
    async isAvailable() {
      return true;
    },
  };
}

function makeConfig(overrides?: Partial<Config['analysis']>): Config {
  return {
    version: 1 as const,
    provider: {
      type: 'anthropic' as const,
      api_key: 'test-key',
      model: 'claude-sonnet-4-20250514',
    },
    telemetry: {
      enabled: false,
      device_id: 'test-device',
    },
    analysis: {
      auto_analyze: true,
      min_messages: 3,
      ...overrides,
    },
  };
}

describe('analyzeSession', () => {
  it('returns a valid SessionAnalysis for a normal transcript', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result).not.toBeNull();
    expect(result!.schema_version).toBe(1);
    expect(result!.session_id).toBe('session-normal');
    expect(result!.provider).toBe('claude_code');
    expect(result!.model_used).toBe('claude-sonnet-4-20250514');
    expect(result!.frictions).toHaveLength(1);
    expect(result!.suggestions).toHaveLength(1);
    expect(result!.satisfaction.positive_signals).toBe(2);
    expect(result!.summary).toContain('auth module');
  });

  it('returns null for transcript below min_messages threshold', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    // short-session has 5 messages; set min_messages to 10
    const result = await analyzeSession(shortSessionPath, {
      config: makeConfig({ min_messages: 10 }),
      adapter,
    });

    expect(result).toBeNull();
    expect(adapter.analyze).not.toHaveBeenCalled();
  });

  it('retries on malformed LLM response then throws on second failure', async () => {
    const adapter = createMockAdapter('this is not json at all');
    await expect(
      analyzeSession(normalSessionPath, {
        config: makeConfig(),
        adapter,
      })
    ).rejects.toThrow('LLM returned invalid JSON after retry');

    expect(adapter.analyze).toHaveBeenCalledTimes(2);
  });

  it('retries on malformed response and succeeds on second attempt', async () => {
    let callCount = 0;
    const adapter = createMockAdapter(() => {
      callCount++;
      if (callCount === 1) return 'not valid json';
      return makeValidLLMJson();
    });

    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result).not.toBeNull();
    expect(adapter.analyze).toHaveBeenCalledTimes(2);
  });

  it('generates UUIDs for suggestions', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result!.suggestions).toHaveLength(1);
    expect(result!.suggestions[0].id).toBeDefined();
    // UUID v4 format
    expect(result!.suggestions[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result!.suggestions[0].status).toBe('pending');
  });

  it('sets analyzed_at as an ISO datetime', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result!.analyzed_at).toBeDefined();
    // Should parse as a valid date
    const date = new Date(result!.analyzed_at);
    expect(date.getTime()).not.toBeNaN();
    // ISO format check
    expect(result!.analyzed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('strips markdown fences from LLM response', async () => {
    const wrappedJson = '```json\n' + makeValidLLMJson() + '\n```';
    const adapter = createMockAdapter(wrappedJson);
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result).not.toBeNull();
    expect(result!.frictions).toHaveLength(1);
  });

  it('strips markdown fences without language tag', async () => {
    const wrappedJson = '```\n' + makeValidLLMJson() + '\n```';
    const adapter = createMockAdapter(wrappedJson);
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result).not.toBeNull();
    expect(result!.suggestions).toHaveLength(1);
  });

  it('has schema_version set to 1', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    const result = await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(result!.schema_version).toBe(1);
  });

  it('calls the mock adapter with the prompt', async () => {
    const adapter = createMockAdapter(makeValidLLMJson());
    await analyzeSession(normalSessionPath, {
      config: makeConfig(),
      adapter,
    });

    expect(adapter.analyze).toHaveBeenCalledTimes(1);
    const prompt = (adapter.analyze as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('session-normal');
    expect(prompt).toContain('Analyze this session');
  });
});
