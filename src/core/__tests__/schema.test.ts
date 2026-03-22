import { describe, it, expect } from 'vitest';
import { SessionAnalysisSchema, FrictionSchema, SuggestionSchema } from '../schema.js';
import { TelemetryPayloadSchema } from '../../telemetry/anonymize.js';

const validSession = {
  schema_version: 1,
  session_id: 'session-abc-123',
  analyzed_at: '2026-03-22T10:00:00Z',
  provider: 'claude_code',
  model_used: 'claude-opus-4-6',
  duration_seconds: 120,
  message_count: 15,
  tool_use_count: 8,
  frictions: [
    {
      type: 'wrong_approach',
      category: 'navigation',
      severity: 'medium',
      description: 'Tried grep instead of Glob',
      count: 2,
    },
  ],
  suggestions: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      target: 'claude_md',
      scope: 'project',
      rule: 'Always use Glob for file search',
      confidence: 0.85,
      reasoning: 'Repeated grep usage where Glob would be faster',
      status: 'pending',
    },
  ],
  satisfaction: {
    positive_signals: 3,
    negative_signals: 1,
  },
  summary: 'Session went mostly well with minor friction on file search approach.',
};

describe('SessionAnalysisSchema', () => {
  it('validates a conforming JSON', () => {
    const result = SessionAnalysisSchema.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { session_id: _, ...incomplete } = validSession;
    const result = SessionAnalysisSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

describe('FrictionSchema', () => {
  it('rejects invalid severity', () => {
    const result = FrictionSchema.safeParse({
      type: 'buggy_code',
      category: 'code',
      severity: 'critical', // invalid
      description: 'Bad code',
      count: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('SuggestionSchema', () => {
  it('defaults status to pending', () => {
    const input = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      target: 'claude_md',
      scope: 'global',
      rule: 'Use Glob',
      confidence: 0.9,
      reasoning: 'Better performance',
      // status omitted — should default to 'pending'
    };
    const result = SuggestionSchema.parse(input);
    expect(result.status).toBe('pending');
  });
});

describe('TelemetryPayloadSchema', () => {
  it('does NOT include description, rule, reasoning, summary fields', () => {
    // Build a valid telemetry payload
    const payload = {
      device_id: 'device-123',
      team_id: null,
      cli_version: '0.1.0',
      analysis: {
        schema_version: 1,
        provider: 'claude_code',
        model_used: 'claude-opus-4-6',
        message_count: 10,
        tool_use_count: 5,
        frictions: [
          { type: 'buggy_code', category: 'code', severity: 'high', count: 1 },
        ],
        suggestions: [{ target: 'claude_md', confidence: 0.8 }],
        satisfaction: { positive_signals: 2, negative_signals: 0 },
      },
    };

    const result = TelemetryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);

    // Verify the schema shape does NOT accept PII fields
    // friction items should not have 'description'
    const frictionKeys = Object.keys(
      TelemetryPayloadSchema.shape.analysis.shape.frictions.element.shape,
    );
    expect(frictionKeys).not.toContain('description');

    // suggestion items should not have 'rule' or 'reasoning'
    const suggestionKeys = Object.keys(
      TelemetryPayloadSchema.shape.analysis.shape.suggestions.element.shape,
    );
    expect(suggestionKeys).not.toContain('rule');
    expect(suggestionKeys).not.toContain('reasoning');

    // top-level analysis should not have 'summary'
    const analysisKeys = Object.keys(
      TelemetryPayloadSchema.shape.analysis.shape,
    );
    expect(analysisKeys).not.toContain('summary');
  });
});
