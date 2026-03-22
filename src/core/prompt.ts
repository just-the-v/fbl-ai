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
      "confidence": "<high|medium|low>",
      "reasoning": "<max 200 chars explaining why>",
      "friction_types": ["<friction type that caused this suggestion>", "..."]
    }
  ],

Confidence criteria:
- high: friction observed 3+ times in the session, OR suggestion fixes a pattern that caused a visible failure (build fail, wrong file edited, rollback)
- medium: friction observed 1-2 times, suggestion clearly linked to an observed problem in the transcript
- low: friction inferred but not explicitly visible, or suggestion based on general best practice rather than an observed problem

Target type examples:
- claude_md: a concrete rule for CLAUDE.md (e.g. "Always run tests before committing")
- skill: a skill to create with a precise behavior (e.g. "Create a /deploy skill that runs terraform plan, shows diff, and asks confirmation before apply")
- workflow: a change in working process (e.g. "Split infrastructure changes and application code into separate sessions")
- hook: an automated hook (e.g. "Add PreToolUse hook that warns before git push to main")
- settings: a Claude Code settings change (e.g. "Add 'npm test' to the allowed commands list in settings.json")

Suggestions must be concrete and directly implementable — not process advice or abstract recommendations.
Return your TOP 3 suggestions maximum, ranked by expected impact on future sessions (most impactful first). Quality over quantity — 1 great suggestion beats 3 mediocre ones.

  "satisfaction": {
    "positive_signals": <int, count of positive user signals like "perfect", "thanks", acceptance>,
    "negative_signals": <int, count of negative signals like "no", "wrong", corrections, frustration>
  },
  "summary": "<max 500 chars summary of the session>"
}

Rules:
- Return ONLY valid JSON, no markdown code fences, no text before or after
- Only flag frictions that would likely recur in future sessions. Ignore one-time setup issues, first-time configuration, or problems already resolved within the session.
- If the session has no frictions, return an empty frictions array
- If you can't determine a field, use reasonable defaults
- Do NOT include id or status fields in suggestions (they are added by the CLI)
- Be specific in suggestions: prefer "Always run tests before committing in this project" over "Run tests"
- Each suggestion MUST reference at least one friction type from the frictions array via friction_types
- Focus on patterns that would improve FUTURE sessions, not just describe what happened`;
}
