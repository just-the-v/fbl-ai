import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from '../prompt.js';
import type { ParsedSession, ParsedMessage } from '../parser.js';

function makeMessage(role: 'user' | 'assistant', content: string, toolNames?: string[]): ParsedMessage {
  const msg: ParsedMessage = { role, content };
  if (toolNames) msg.toolNames = toolNames;
  return msg;
}

function makeSession(messageCount: number, overrides?: Partial<ParsedSession>): ParsedSession {
  const messages: ParsedMessage[] = [];
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const tools = role === 'assistant' ? ['Bash'] : undefined;
    messages.push(makeMessage(role as 'user' | 'assistant', `Message number ${i}. ${filler.repeat(3)}`, tools));
  }
  return {
    sessionId: 'test-session-123',
    messages,
    messageCount: messages.length,
    toolUseCount: messages.filter(m => m.toolNames?.length).length,
    durationSeconds: 600,
    estimatedTokens: messageCount * 50,
    ...overrides,
  };
}

describe('buildAnalysisPrompt', () => {
  it('on a 10-message session includes full transcript', () => {
    const session = makeSession(10);
    const prompt = buildAnalysisPrompt(session);

    // All 10 messages should be present
    for (let i = 0; i < 10; i++) {
      expect(prompt).toContain(`Message number ${i}`);
    }
    // No omission marker
    expect(prompt).not.toContain('messages omitted');
  });

  it('on a 500-message session with maxTokenBudget=8000 truncates', () => {
    const session = makeSession(500);
    const prompt = buildAnalysisPrompt(session, 8000);

    // Should contain omission marker
    expect(prompt).toContain('messages omitted');
    // Should contain early messages (head 20%)
    expect(prompt).toContain('Message number 0');
    // Should contain late messages (tail 30%)
    expect(prompt).toContain('Message number 499');
    // Should NOT contain all middle messages
    expect(prompt).not.toContain('Message number 200');
  });

  it('includes all 9 FrictionType values', () => {
    const session = makeSession(5);
    const prompt = buildAnalysisPrompt(session);

    const frictionTypes = [
      'wrong_approach',
      'buggy_code',
      'incorrect_assumption',
      'scope_bloat',
      'wrong_tool',
      'repeated_failure',
      'missing_context',
      'permission_friction',
      'context_overflow',
    ];

    for (const ft of frictionTypes) {
      expect(prompt).toContain(ft);
    }
  });

  it('includes all 5 suggestion targets', () => {
    const session = makeSession(5);
    const prompt = buildAnalysisPrompt(session);

    const targets = ['claude_md', 'skill', 'workflow', 'hook', 'settings'];
    for (const t of targets) {
      expect(prompt).toContain(t);
    }
  });

  it('requests JSON without markdown fences', () => {
    const session = makeSession(5);
    const prompt = buildAnalysisPrompt(session);

    expect(prompt).toContain('NO markdown fences');
    expect(prompt).toContain('ONLY the JSON');
    expect(prompt).toContain('no markdown code fences');
  });

  it('omission marker is present when truncated', () => {
    const session = makeSession(500);
    const prompt = buildAnalysisPrompt(session, 8000);

    const match = prompt.match(/\[\.\.\. (\d+) messages omitted \.\.\.\]/);
    expect(match).not.toBeNull();
    const omitted = parseInt(match![1], 10);
    expect(omitted).toBeGreaterThan(0);
    // Most messages should be omitted given the tight budget
    expect(omitted).toBeGreaterThan(400);
  });
});
