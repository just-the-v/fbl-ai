import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-loop-gain-test-'));
  process.env.FBL_DATA_DIR = tmpDir;
  process.env.FBL_CONFIG = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FBL_DATA_DIR;
  delete process.env.FBL_CONFIG;
});

function makeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1 as const,
    session_id: (overrides.session_id as string) ?? randomUUID(),
    analyzed_at: (overrides.analyzed_at as string) ?? '2026-03-20T10:00:00Z',
    provider: 'claude_code' as const,
    model_used: 'claude-sonnet-4-20250514',
    message_count: 10,
    frictions: (overrides.frictions as Array<{
      type: string;
      category: string;
      severity: string;
      description: string;
      count: number;
    }>) ?? [],
    suggestions: [],
    satisfaction: { positive_signals: 3, negative_signals: 1 },
    summary: 'Test analysis summary',
    ...overrides,
  };
}

function storeAnalysis(analysis: ReturnType<typeof makeAnalysis>): void {
  const dir = path.join(tmpDir, 'analyses');
  fs.mkdirSync(dir, { recursive: true });
  const date = analysis.analyzed_at.slice(0, 10);
  const shortId = analysis.session_id.slice(0, 8);
  const filename = `${date}-${shortId}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(analysis, null, 2), 'utf-8');
}

function storeSuggestions(items: Array<Record<string, unknown>>): void {
  const dir = path.join(tmpDir, 'suggestions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items, null, 2), 'utf-8');
}

describe('gain command', () => {
  it('shows graceful message when no analyses exist', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      // Dynamic import to pick up env vars
      const { registerGainCommand } = await import('../gain.js');
      const { Command } = await import('commander');
      const program = new Command();
      registerGainCommand(program);
      await program.parseAsync(['node', 'test', 'gain']);

      const output = logs.join('\n');
      expect(output).toContain('No analyses yet');
      expect(output).toContain('fbl analyze');
    } finally {
      console.log = originalLog;
    }
  });

  it('shows 1 row and stable trajectory for single week of data', async () => {
    // All analyses in the same week (Mon Mar 16 - Sun Mar 22, 2026)
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-17T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'medium', description: 'Missing ctx', count: 3 },
      ],
    }));
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-19T14:00:00Z',
      frictions: [
        { type: 'wrong_approach', category: 'approach', severity: 'high', description: 'Wrong approach', count: 2 },
      ],
    }));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const { registerGainCommand } = await import('../gain.js');
      const { Command } = await import('commander');
      const program = new Command();
      registerGainCommand(program);
      await program.parseAsync(['node', 'test', 'gain', '--weeks', '4']);

      const output = logs.join('\n');
      expect(output).toContain('Friction Trend');
      expect(output).toContain('Mar');
      // With only 1 week, trajectory should say stable or not enough data
      expect(output).toMatch(/stable/i);
      expect(output).toContain('Total sessions: 2');
    } finally {
      console.log = originalLog;
    }
  });

  it('groups multiple weeks correctly and computes trajectory', async () => {
    // Week 1 (oldest): Feb 24 - Mar 01 - high friction
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-02-25T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'high', description: 'Test', count: 6 },
      ],
    }));

    // Week 2: Mar 02-08 - medium friction
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-04T10:00:00Z',
      frictions: [
        { type: 'wrong_approach', category: 'approach', severity: 'medium', description: 'Test', count: 4 },
      ],
    }));

    // Week 3: Mar 09-15 - lower friction
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-11T10:00:00Z',
      frictions: [
        { type: 'permission_friction', category: 'permissions', severity: 'low', description: 'Test', count: 2 },
      ],
    }));

    // Week 4 (newest): Mar 16-22 - lowest friction
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-18T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'low', description: 'Test', count: 1 },
      ],
    }));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const { registerGainCommand } = await import('../gain.js');
      const { Command } = await import('commander');
      const program = new Command();
      registerGainCommand(program);
      await program.parseAsync(['node', 'test', 'gain', '--weeks', '4']);

      const output = logs.join('\n');

      // Should show 4 rows
      expect(output).toContain('Friction Trend');
      expect(output).toContain('Feb');
      expect(output).toContain('Mar');

      // Trajectory: from 6.0 avg to 1.0 avg = -83% => improving
      expect(output).toMatch(/improving/i);

      expect(output).toContain('Total sessions: 4');
    } finally {
      console.log = originalLog;
    }
  });

  it('aggregates friction types sorted by count desc', async () => {
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-18T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'medium', description: 'Test', count: 10 },
        { type: 'wrong_approach', category: 'approach', severity: 'high', description: 'Test', count: 5 },
      ],
    }));
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-19T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'medium', description: 'Test', count: 8 },
        { type: 'permission_friction', category: 'permissions', severity: 'low', description: 'Test', count: 3 },
      ],
    }));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const { registerGainCommand } = await import('../gain.js');
      const { Command } = await import('commander');
      const program = new Command();
      registerGainCommand(program);
      await program.parseAsync(['node', 'test', 'gain']);

      const output = logs.join('\n');

      // missing_context should appear first (18 total), then wrong_approach (5), then permission_friction (3)
      expect(output).toContain('Top friction types');
      const missingIdx = output.indexOf('missing_context');
      const wrongIdx = output.indexOf('wrong_approach');
      const permIdx = output.indexOf('permission_friction');
      expect(missingIdx).toBeLessThan(wrongIdx);
      expect(wrongIdx).toBeLessThan(permIdx);

      // Check counts appear
      expect(output).toContain('18');
      expect(output).toContain('5');
      expect(output).toContain('3');
    } finally {
      console.log = originalLog;
    }
  });

  it('shows suggestion stats from stored suggestions', async () => {
    storeAnalysis(makeAnalysis({
      session_id: randomUUID(),
      analyzed_at: '2026-03-18T10:00:00Z',
      frictions: [
        { type: 'missing_context', category: 'context', severity: 'medium', description: 'Test', count: 2 },
      ],
    }));

    storeSuggestions([
      { id: randomUUID(), target: 'claude_md', scope: 'global', rule: 'Rule A', confidence: 'high' as const, reasoning: 'R', status: 'applied', source_analysis: 'a-1' },
      { id: randomUUID(), target: 'claude_md', scope: 'global', rule: 'Rule B', confidence: 'high' as const, reasoning: 'R', status: 'applied', source_analysis: 'a-2' },
      { id: randomUUID(), target: 'skill', scope: 'project', rule: 'Rule C', confidence: 'medium' as const, reasoning: 'R', status: 'pending', source_analysis: 'a-3' },
    ]);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const { registerGainCommand } = await import('../gain.js');
      const { Command } = await import('commander');
      const program = new Command();
      registerGainCommand(program);
      await program.parseAsync(['node', 'test', 'gain']);

      const output = logs.join('\n');
      expect(output).toContain('2 applied');
      expect(output).toContain('1 pending');
    } finally {
      console.log = originalLog;
    }
  });
});
