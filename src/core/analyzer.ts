import { randomUUID } from 'node:crypto';
import { parseTranscript } from './parser.js';
import { buildAnalysisPrompt } from './prompt.js';
import { SessionAnalysisSchema, FrictionType, type SessionAnalysis } from './schema.js';
import { createAdapter } from '../adapters/registry.js';
import type { Config } from '../storage/config.js';
import type { LLMAdapter } from '../adapters/types.js';

export interface AnalyzeOptions {
  config: Config;
  adapter?: LLMAdapter; // allow injecting for testing
  maxTokenBudget?: number;
  projectPath?: string; // Working directory where the session ran
}

export async function analyzeSession(
  transcriptPath: string,
  options: AnalyzeOptions
): Promise<SessionAnalysis | null> {
  // 1. Parse the JSONL transcript
  const session = parseTranscript(transcriptPath);

  // 2. Check min_messages threshold
  if (session.messageCount < options.config.analysis.min_messages) {
    return null; // skip short sessions
  }

  // 3. Get or create adapter
  const adapter = options.adapter ?? createAdapter(options.config);

  // 4. Build prompt
  const prompt = buildAnalysisPrompt(session, options.maxTokenBudget);

  // 5. Call LLM
  let response = await adapter.analyze(prompt);

  // 6. Parse and validate LLM response
  let parsed = tryParseResponse(response.content);

  // 7. If malformed, retry once with error feedback
  if (!parsed) {
    const retryPrompt =
      prompt +
      '\n\nIMPORTANT: Your previous response was not valid JSON. Please output ONLY a JSON object with no markdown fences or extra text.';
    response = await adapter.analyze(retryPrompt);
    parsed = tryParseResponse(response.content);
    if (!parsed) {
      const preview = response.content.slice(0, 200);
      throw new Error(`LLM returned invalid JSON after retry. Response starts with: ${preview}`);
    }
  }

  // 8. Enrich: add IDs to suggestions, schema_version, metadata
  const enriched: SessionAnalysis = {
    schema_version: 1 as const,
    session_id: session.sessionId,
    analyzed_at: new Date().toISOString(),
    provider: 'claude_code' as const,
    model_used: response.model,
    duration_seconds: session.durationSeconds,
    message_count: session.messageCount,
    tool_use_count: session.toolUseCount,
    frictions: (parsed.frictions ?? []).filter((f: any) =>
      FrictionType.safeParse(f.type).success
    ).map((f: any) => ({
      ...f,
      description: typeof f.description === 'string' ? f.description.slice(0, 200) : f.description,
      category: typeof f.category === 'string' ? f.category.slice(0, 50) : f.category,
    })),
    suggestions: (parsed.suggestions ?? []).map((s: any) => ({
      ...s,
      rule: typeof s.rule === 'string' ? s.rule.slice(0, 300) : s.rule,
      reasoning: typeof s.reasoning === 'string' ? s.reasoning.slice(0, 200) : s.reasoning,
      friction_types: Array.isArray(s.friction_types)
        ? s.friction_types.filter((ft: any) => FrictionType.safeParse(ft).success)
        : [],
      id: randomUUID(),
      status: 'pending' as const,
    })),
    satisfaction: parsed.satisfaction ?? {
      positive_signals: 0,
      negative_signals: 0,
    },
    summary: parsed.summary ?? '',
    ...(session.startedAt ? { session_started_at: session.startedAt } : {}),
    ...(options.projectPath ? { project_path: options.projectPath } : {}),
  };

  // 9. Validate with Zod
  return SessionAnalysisSchema.parse(enriched);
}

function tryParseResponse(content: string): any | null {
  // 1. Try direct parse first
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to extraction strategies
  }

  // 2. Extract from markdown fences (greedy: largest fenced block)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Extract first { ... } or [ ... ] JSON structure
  const jsonStart = trimmed.search(/[{\[]/);
  if (jsonStart !== -1) {
    const bracket = trimmed[jsonStart];
    const closeBracket = bracket === '{' ? '}' : ']';
    const lastClose = trimmed.lastIndexOf(closeBracket);
    if (lastClose > jsonStart) {
      try {
        return JSON.parse(trimmed.slice(jsonStart, lastClose + 1));
      } catch {
        // give up
      }
    }
  }

  return null;
}
