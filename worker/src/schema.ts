import { z } from 'zod';

// Copied from CLI src/core/schema.ts — no monorepo yet

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
