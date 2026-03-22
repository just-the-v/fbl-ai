import { z } from 'zod';

// Copied from CLI src/core/schema.ts — adapted for zod v3

export const FrictionType = z.enum([
  'wrong_approach',
  'buggy_code',
  'incorrect_assumption',
  'scope_bloat',
  'wrong_tool',
  'repeated_failure',
  'missing_context',
  'permission_friction',
  'context_overflow',
]);

export const TelemetryPayloadSchema = z.object({
  device_id: z.string(),
  team_id: z.string().nullable(),
  cli_version: z.string(),
  analysis: z.object({
    schema_version: z.literal(1),
    provider: z.string(),
    model_used: z.string(),
    message_count: z.number().int(),
    tool_use_count: z.number().int().optional(),
    frictions: z.array(
      z.object({
        type: FrictionType,
        category: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        count: z.number().int().min(1),
      }),
    ),
    suggestions: z.array(
      z.object({
        target: z.enum(['claude_md', 'skill', 'workflow', 'hook', 'settings']),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    ),
    satisfaction: z.object({
      positive_signals: z.number().int(),
      negative_signals: z.number().int(),
    }),
  }),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
