import { z } from 'zod';

// --- Friction ---

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

export const FrictionSchema = z.object({
  type: FrictionType,
  category: z.string().max(50),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().max(200),
  count: z.int().min(1),
});

export type Friction = z.infer<typeof FrictionSchema>;

// --- Suggestion ---

export const SuggestionSchema = z.object({
  id: z.uuid(),
  target: z.enum(['claude_md', 'skill', 'workflow', 'hook', 'settings']),
  scope: z.enum(['global', 'project']),
  rule: z.string().max(300),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().max(200),
  friction_types: z.array(FrictionType).min(1),
  status: z.enum(['pending', 'applied', 'dismissed']).default('pending'),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

// --- Session Analysis ---

export const SessionAnalysisSchema = z.object({
  schema_version: z.literal(1),
  session_id: z.string(),
  analyzed_at: z.iso.datetime(),
  session_started_at: z.iso.datetime().optional(),
  provider: z.literal('claude_code'),
  model_used: z.string(),
  duration_seconds: z.number().optional(),
  message_count: z.int(),
  tool_use_count: z.int().optional(),
  frictions: z.array(FrictionSchema),
  suggestions: z.array(SuggestionSchema),
  satisfaction: z.object({
    positive_signals: z.int(),
    negative_signals: z.int(),
  }),
  summary: z.string().max(1000),
  project_path: z.string().optional(),
});

export type SessionAnalysis = z.infer<typeof SessionAnalysisSchema>;
