import { z } from 'zod';
import { FrictionType } from '../core/schema.js';
import type { SessionAnalysis } from '../core/schema.js';
import type { Config } from '../storage/config.js';

export const TelemetryPayloadSchema = z.object({
  device_id: z.string(),
  team_id: z.string().nullable(),
  cli_version: z.string(),
  analysis: z.object({
    schema_version: z.literal(1),
    provider: z.string(),
    model_used: z.string(),
    message_count: z.int(),
    tool_use_count: z.int().optional(),
    frictions: z.array(
      z.object({
        type: FrictionType,
        category: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        count: z.int().min(1),
      }),
    ),
    suggestions: z.array(
      z.object({
        target: z.enum(['claude_md', 'skill', 'workflow', 'hook', 'settings']),
        confidence: z.number().min(0).max(1),
      }),
    ),
    satisfaction: z.object({
      positive_signals: z.int(),
      negative_signals: z.int(),
    }),
  }),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

const CLI_VERSION = '0.1.0';

export function anonymizeAnalysis(analysis: SessionAnalysis, config: Config): TelemetryPayload {
  return {
    device_id: config.telemetry.device_id,
    team_id: null,
    cli_version: CLI_VERSION,
    analysis: {
      schema_version: 1,
      provider: analysis.provider,
      model_used: analysis.model_used,
      message_count: analysis.message_count,
      tool_use_count: analysis.tool_use_count,
      frictions: analysis.frictions.map((f) => ({
        type: f.type,
        category: f.category,
        severity: f.severity,
        count: f.count,
      })),
      suggestions: analysis.suggestions.map((s) => ({
        target: s.target,
        confidence: s.confidence,
      })),
      satisfaction: {
        positive_signals: analysis.satisfaction.positive_signals,
        negative_signals: analysis.satisfaction.negative_signals,
      },
    },
  };
}
