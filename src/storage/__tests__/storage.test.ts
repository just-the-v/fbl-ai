import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-loop-test-'));
  process.env.FBL_DATA_DIR = tmpDir;
  process.env.FBL_CONFIG = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FBL_DATA_DIR;
  delete process.env.FBL_CONFIG;
});

function makeConfig() {
  return {
    version: 1 as const,
    provider: { type: 'anthropic' as const, api_key: 'sk-test' },
    telemetry: { enabled: false, device_id: 'test-device' },
    analysis: { auto_analyze: true, min_messages: 5 },
  };
}

function makeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1 as const,
    session_id: overrides.session_id as string ?? randomUUID(),
    analyzed_at: (overrides.analyzed_at as string) ?? '2026-03-20T10:00:00Z',
    provider: 'claude_code' as const,
    model_used: 'claude-sonnet-4-20250514',
    message_count: 10,
    frictions: [],
    suggestions: [],
    satisfaction: { positive_signals: 3, negative_signals: 1 },
    summary: 'Test analysis summary',
    ...overrides,
  };
}

describe('config', () => {
  it('saveConfig creates directory and writes valid config.json', async () => {
    const { saveConfig, loadConfig } = await import('../config.js');
    const config = makeConfig();
    saveConfig(config);

    const configPath = path.join(tmpDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const loaded = loadConfig();
    expect(loaded.version).toBe(1);
    expect(loaded.provider.type).toBe('anthropic');
  });

  it('loadConfig throws if config is invalid', async () => {
    const { loadConfig } = await import('../config.js');
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ version: 99 }), 'utf-8');

    expect(() => loadConfig()).toThrow();
  });

  it('ensureDataDirs creates all subdirectories', async () => {
    const { ensureDataDirs } = await import('../config.js');
    ensureDataDirs();

    expect(fs.existsSync(path.join(tmpDir, 'analyses'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'suggestions'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'cache'))).toBe(true);
  });

  it('FBL_DATA_DIR overrides default directory', async () => {
    const { getDataDir } = await import('../config.js');
    expect(getDataDir()).toBe(tmpDir);
  });
});

describe('analyses', () => {
  it('storeAnalysis writes the correct file', async () => {
    const { storeAnalysis } = await import('../analyses.js');
    const analysis = makeAnalysis({ session_id: 'abcdef12-3456-7890-abcd-ef1234567890' });
    storeAnalysis(analysis);

    const expected = path.join(tmpDir, 'analyses', '2026-03-20-abcdef12.json');
    expect(fs.existsSync(expected)).toBe(true);

    const content = JSON.parse(fs.readFileSync(expected, 'utf-8'));
    expect(content.session_id).toBe('abcdef12-3456-7890-abcd-ef1234567890');
  });

  it('listAnalyses filters by date', async () => {
    const { storeAnalysis, listAnalyses } = await import('../analyses.js');

    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-15T10:00:00Z' }));
    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-20T10:00:00Z' }));
    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-25T10:00:00Z' }));

    const filtered = listAnalyses({ since: new Date('2026-03-18'), until: new Date('2026-03-22') });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].analyzed_at).toBe('2026-03-20T10:00:00Z');
  });

  it('listAnalyses returns sorted by date desc', async () => {
    const { storeAnalysis, listAnalyses } = await import('../analyses.js');

    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-15T10:00:00Z' }));
    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-25T10:00:00Z' }));
    storeAnalysis(makeAnalysis({ session_id: randomUUID(), analyzed_at: '2026-03-20T10:00:00Z' }));

    const all = listAnalyses();
    expect(all[0].analyzed_at).toBe('2026-03-25T10:00:00Z');
    expect(all[2].analyzed_at).toBe('2026-03-15T10:00:00Z');
  });

  it('isAlreadyAnalyzed returns true/false correctly', async () => {
    const { storeAnalysis, isAlreadyAnalyzed } = await import('../analyses.js');
    const sessionId = randomUUID();
    expect(isAlreadyAnalyzed(sessionId)).toBe(false);

    storeAnalysis(makeAnalysis({ session_id: sessionId }));
    expect(isAlreadyAnalyzed(sessionId)).toBe(true);
  });

  it('getAnalysis returns the analysis by sessionId', async () => {
    const { storeAnalysis, getAnalysis } = await import('../analyses.js');
    const sessionId = randomUUID();
    storeAnalysis(makeAnalysis({ session_id: sessionId }));

    const result = getAnalysis(sessionId);
    expect(result).toBeDefined();
    expect(result!.session_id).toBe(sessionId);
  });
});

describe('suggestions', () => {
  it('loadSuggestionsIndex returns empty array when no index', async () => {
    const { loadSuggestionsIndex } = await import('../suggestions.js');
    expect(loadSuggestionsIndex()).toEqual([]);
  });

  it('saveSuggestionsIndex and loadSuggestionsIndex roundtrip', async () => {
    const { saveSuggestionsIndex, loadSuggestionsIndex } = await import('../suggestions.js');
    const items = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed errors',
        confidence: 0.85,
        reasoning: 'Repeated type errors seen',
        status: 'pending' as const,
        source_analysis: 'analysis-1',
      },
    ];
    saveSuggestionsIndex(items);
    const loaded = loadSuggestionsIndex();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].rule).toBe('Always use typed errors');
  });

  it('getSuggestionsByStatus filters correctly', async () => {
    const { saveSuggestionsIndex, getSuggestionsByStatus } = await import('../suggestions.js');
    const items = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Rule A',
        confidence: 0.9,
        reasoning: 'Reason A',
        status: 'pending' as const,
        source_analysis: 'a-1',
      },
      {
        id: randomUUID(),
        target: 'skill' as const,
        scope: 'project' as const,
        rule: 'Rule B',
        confidence: 0.7,
        reasoning: 'Reason B',
        status: 'applied' as const,
        source_analysis: 'a-2',
        applied_at: '2026-03-20T12:00:00Z',
      },
    ];
    saveSuggestionsIndex(items);

    expect(getSuggestionsByStatus('pending')).toHaveLength(1);
    expect(getSuggestionsByStatus('applied')).toHaveLength(1);
    expect(getSuggestionsByStatus('dismissed')).toHaveLength(0);
  });

  it('updateSuggestionStatus updates and persists', async () => {
    const { saveSuggestionsIndex, updateSuggestionStatus, loadSuggestionsIndex } = await import('../suggestions.js');
    const id = randomUUID();
    saveSuggestionsIndex([
      {
        id,
        target: 'workflow' as const,
        scope: 'global' as const,
        rule: 'Rule C',
        confidence: 0.8,
        reasoning: 'Reason C',
        status: 'pending' as const,
        source_analysis: 'a-3',
      },
    ]);

    updateSuggestionStatus(id, 'applied', '2026-03-22T10:00:00Z');
    const loaded = loadSuggestionsIndex();
    expect(loaded[0].status).toBe('applied');
    expect(loaded[0].applied_at).toBe('2026-03-22T10:00:00Z');
  });

  it('updateSuggestionStatus throws for unknown id', async () => {
    const { saveSuggestionsIndex, updateSuggestionStatus } = await import('../suggestions.js');
    saveSuggestionsIndex([]);
    expect(() => updateSuggestionStatus('nonexistent', 'dismissed')).toThrow('not found');
  });

  it('getNextPendingSuggestionNumber returns correct number', async () => {
    const { saveSuggestionsIndex, getNextPendingSuggestionNumber } = await import('../suggestions.js');
    saveSuggestionsIndex([
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'R1',
        confidence: 0.9,
        reasoning: 'X',
        status: 'pending' as const,
        source_analysis: 'a',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'R2',
        confidence: 0.9,
        reasoning: 'Y',
        status: 'applied' as const,
        source_analysis: 'b',
      },
    ]);
    expect(getNextPendingSuggestionNumber()).toBe(2); // 1 pending + 1
  });
});

describe('deduplicateSuggestions', () => {
  it('groups suggestions with same target and similar rules', async () => {
    const { deduplicateSuggestions } = await import('../suggestions.js');
    const suggestions = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed error handling in TypeScript',
        confidence: 0.9,
        reasoning: 'Reason A',
        status: 'pending' as const,
        source_analysis: 'session-1',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed error handling for TypeScript code',
        confidence: 0.7,
        reasoning: 'Reason B',
        status: 'pending' as const,
        source_analysis: 'session-2',
      },
    ];
    const result = deduplicateSuggestions(suggestions);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9); // keeps highest confidence
    expect(result[0].sessionCount).toBe(2);
  });

  it('does not group suggestions with different targets', async () => {
    const { deduplicateSuggestions } = await import('../suggestions.js');
    const suggestions = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed errors',
        confidence: 0.9,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-1',
      },
      {
        id: randomUUID(),
        target: 'skill' as const,
        scope: 'global' as const,
        rule: 'Always use typed errors',
        confidence: 0.8,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-2',
      },
    ];
    const result = deduplicateSuggestions(suggestions);
    expect(result).toHaveLength(2);
  });

  it('accumulates session counts across multiple sessions', async () => {
    const { deduplicateSuggestions } = await import('../suggestions.js');
    const suggestions = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed error handling in TypeScript projects',
        confidence: 0.9,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-1',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Use typed error handling in TypeScript',
        confidence: 0.7,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-2',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed error handling for TypeScript code',
        confidence: 0.8,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-3',
      },
    ];
    const result = deduplicateSuggestions(suggestions);
    expect(result).toHaveLength(1);
    expect(result[0].sessionCount).toBe(3);
    expect(result[0].confidence).toBe(0.9); // keeps highest
  });

  it('merges suggestions with varied wording but same core concept', async () => {
    const { deduplicateSuggestions } = await import('../suggestions.js');
    const suggestions = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Add error handling rules to CLAUDE.md',
        confidence: 0.85,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-1',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Add error handling conventions and rules',
        confidence: 0.75,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-2',
      },
    ];
    const result = deduplicateSuggestions(suggestions);
    expect(result).toHaveLength(1);
    expect(result[0].sessionCount).toBe(2);
  });

  it('does not group suggestions with very different rules', async () => {
    const { deduplicateSuggestions } = await import('../suggestions.js');
    const suggestions = [
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Always use typed error handling',
        confidence: 0.9,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-1',
      },
      {
        id: randomUUID(),
        target: 'claude_md' as const,
        scope: 'global' as const,
        rule: 'Prefer functional programming patterns',
        confidence: 0.8,
        reasoning: 'R',
        status: 'pending' as const,
        source_analysis: 'session-2',
      },
    ];
    const result = deduplicateSuggestions(suggestions);
    expect(result).toHaveLength(2);
  });
});

describe('sessions', () => {
  it('discoverSessions parses duration and returns files', async () => {
    // We test the duration parser indirectly; actual file scanning
    // depends on ~/.claude existing. We just ensure no crash on empty.
    const { discoverSessions } = await import('../sessions.js');
    // This may return empty array if no .claude/projects/ exists
    const sessions = discoverSessions('7d');
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('discoverSessions throws on invalid duration', async () => {
    const { discoverSessions } = await import('../sessions.js');
    expect(() => discoverSessions('abc')).toThrow('Invalid duration');
  });
});
