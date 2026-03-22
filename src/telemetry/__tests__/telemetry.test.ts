import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { anonymizeAnalysis, TelemetryPayloadSchema } from '../anonymize.js';
import { sendTelemetry } from '../client.js';
import type { SessionAnalysis } from '../../core/schema.js';
import type { Config } from '../../storage/config.js';

function makeAnalysis(overrides?: Partial<SessionAnalysis>): SessionAnalysis {
  return {
    schema_version: 1 as const,
    session_id: 'test-session-id',
    analyzed_at: new Date().toISOString(),
    provider: 'claude_code' as const,
    model_used: 'claude-sonnet-4-20250514',
    duration_seconds: 120,
    message_count: 10,
    tool_use_count: 5,
    frictions: [
      {
        type: 'wrong_approach',
        category: 'code-generation',
        severity: 'high',
        description: 'Claude tried an incorrect approach to solve the problem',
        count: 2,
      },
      {
        type: 'missing_context',
        category: 'documentation',
        severity: 'low',
        description: 'Missing project context led to wrong assumptions',
        count: 1,
      },
    ],
    suggestions: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        target: 'claude_md',
        scope: 'project',
        rule: 'Always read the README before making changes',
        confidence: 0.85,
        reasoning: 'Multiple sessions showed missing context issues',
        status: 'pending',
      },
    ],
    satisfaction: {
      positive_signals: 3,
      negative_signals: 1,
    },
    summary: 'Session had some friction due to missing context, but overall productive',
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    version: 1 as const,
    provider: {
      type: 'anthropic',
      api_key: 'sk-ant-test-key-12345',
      model: 'claude-sonnet-4-20250514',
    },
    telemetry: {
      enabled: true,
      device_id: 'test-device-id',
    },
    analysis: {
      auto_analyze: false,
      min_messages: 5,
    },
    ...overrides,
  };
}

describe('anonymizeAnalysis', () => {
  it('strips description from frictions', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    for (const friction of payload.analysis.frictions) {
      expect(friction).not.toHaveProperty('description');
    }
  });

  it('strips rule and reasoning from suggestions', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    for (const suggestion of payload.analysis.suggestions) {
      expect(suggestion).not.toHaveProperty('rule');
      expect(suggestion).not.toHaveProperty('reasoning');
    }
  });

  it('strips summary from analysis', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    expect(payload.analysis).not.toHaveProperty('summary');
  });

  it('keeps friction type, category, severity, count', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    expect(payload.analysis.frictions).toHaveLength(2);
    expect(payload.analysis.frictions[0]).toEqual({
      type: 'wrong_approach',
      category: 'code-generation',
      severity: 'high',
      count: 2,
    });
    expect(payload.analysis.frictions[1]).toEqual({
      type: 'missing_context',
      category: 'documentation',
      severity: 'low',
      count: 1,
    });
  });

  it('keeps suggestion target and confidence only', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    expect(payload.analysis.suggestions).toHaveLength(1);
    expect(payload.analysis.suggestions[0]).toEqual({
      target: 'claude_md',
      confidence: 0.85,
    });
  });

  it('produces a payload that passes TelemetryPayloadSchema validation', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    const result = TelemetryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('sets device_id from config and team_id to null', () => {
    const analysis = makeAnalysis();
    const config = makeConfig();
    const payload = anonymizeAnalysis(analysis, config);

    expect(payload.device_id).toBe('test-device-id');
    expect(payload.team_id).toBeNull();
    expect(payload.cli_version).toBe('0.1.0');
  });
});

describe('sendTelemetry', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.FBL_TELEMETRY;
  });

  it('is a no-op when telemetry.enabled=false', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const analysis = makeAnalysis();
    const config = makeConfig({ telemetry: { enabled: false, device_id: 'test' } });

    await sendTelemetry(analysis, config);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is a no-op when FBL_TELEMETRY=0', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    process.env.FBL_TELEMETRY = '0';

    const analysis = makeAnalysis();
    const config = makeConfig();

    await sendTelemetry(analysis, config);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never throws even if fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    const analysis = makeAnalysis();
    const config = makeConfig();

    // Should not throw
    await expect(sendTelemetry(analysis, config)).resolves.toBeUndefined();
  });

  it('calls fetch when telemetry is enabled', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const analysis = makeAnalysis();
    const config = makeConfig();

    await sendTelemetry(analysis, config);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.feedback-loop.dev'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
