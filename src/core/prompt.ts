import { ParsedSession, ParsedMessage } from './parser.js';

function formatMessage(msg: ParsedMessage): string {
  const toolSuffix = msg.toolNames?.length ? `:${msg.toolNames.join(',')}` : '';
  return `[${msg.role}${toolSuffix}] ${msg.content}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTranscript(session: ParsedSession, maxTokenBudget: number): string {
  const formatted = session.messages.map(formatMessage);
  const fullTranscript = formatted.join('\n');

  const maxChars = maxTokenBudget * 4;

  if (fullTranscript.length <= maxChars) {
    return fullTranscript;
  }

  // Truncation: keep 20% from beginning, 30% from end, omit middle
  const totalMessages = formatted.length;

  // Calculate initial head/tail counts by message ratio
  let headCount = Math.max(1, Math.floor(totalMessages * 0.2));
  let tailCount = Math.max(1, Math.floor(totalMessages * 0.3));

  // Ensure we actually omit something
  if (headCount + tailCount >= totalMessages) {
    headCount = Math.max(1, Math.floor(totalMessages * 0.2));
    tailCount = Math.max(1, totalMessages - headCount - 1);
  }

  // Reduce head/tail proportionally if their combined text exceeds budget
  const markerTemplate = '[... 999999 messages omitted ...]';
  const markerOverhead = markerTemplate.length + 2; // newlines

  while (headCount + tailCount > 2) {
    const headText = formatted.slice(0, headCount).join('\n');
    const tailText = formatted.slice(totalMessages - tailCount).join('\n');
    if (headText.length + tailText.length + markerOverhead <= maxChars) {
      break;
    }
    // Reduce the larger portion
    if (headCount > tailCount) {
      headCount = Math.max(1, headCount - 1);
    } else {
      tailCount = Math.max(1, tailCount - 1);
    }
  }

  const omittedCount = totalMessages - headCount - tailCount;
  const headMessages = formatted.slice(0, headCount);
  const tailMessages = formatted.slice(totalMessages - tailCount);
  const marker = `[... ${omittedCount} messages omitted ...]`;

  return [...headMessages, marker, ...tailMessages].join('\n');
}

export function buildAnalysisPrompt(session: ParsedSession, maxTokenBudget = 190000): string {
  const transcript = formatTranscript(session, maxTokenBudget);

  return `You are an expert AI coding assistant analyzer. Analyze the following Claude Code session transcript and identify frictions, patterns, and actionable suggestions.

## Session Metadata
- Session ID: ${session.sessionId}
- Messages: ${session.messageCount}
- Tool uses: ${session.toolUseCount}
- Duration: ${session.durationSeconds ? Math.round(session.durationSeconds / 60) + ' minutes' : 'unknown'}

## Transcript
${transcript}

## Instructions
Analyze this session and return a JSON object (NO markdown fences, NO explanation, ONLY the JSON) with this exact structure:

{
  "frictions": [
    {
      "type": "<one of: wrong_approach, buggy_code, incorrect_assumption, scope_bloat, wrong_tool, repeated_failure, missing_context, permission_friction, context_overflow>",
      "category": "<string, e.g. terraform, git, testing, docker, etc.>",
      "severity": "<low|medium|high>",
      "description": "<max 200 chars describing the friction>",
      "count": <integer, how many times this friction occurred>
    }
  ],
  "suggestions": [
    {
      "target": "<one of: claude_md, skill, workflow, hook, settings>",
      "scope": "<global|project>",
      "rule": "<max 300 chars, the actionable rule to add>",
      "confidence": <0.0 to 1.0>,
      "reasoning": "<max 200 chars explaining why>"
    }
  ],
  "satisfaction": {
    "positive_signals": <int, count of positive user signals like "perfect", "thanks", acceptance>,
    "negative_signals": <int, count of negative signals like "no", "wrong", corrections, frustration>
  },
  "summary": "<max 500 chars summary of the session>"
}

Rules:
- Return ONLY valid JSON, no markdown code fences, no text before or after
- If the session has no frictions, return an empty frictions array
- If you can't determine a field, use reasonable defaults
- Do NOT include id or status fields in suggestions (they are added by the CLI)
- Be specific in suggestions: prefer "Always run tests before committing in this project" over "Run tests"
- Focus on patterns that would improve FUTURE sessions, not just describe what happened`;
}
