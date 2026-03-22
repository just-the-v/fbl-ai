import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock modules before importing anything that uses them
vi.mock('../../core/analyzer.js', () => ({
  analyzeSession: vi.fn(),
}));

vi.mock('../../storage/config.js', () => ({
  loadConfig: vi.fn(),
  getDataDir: vi.fn(),
  ensureDataDirs: vi.fn(),
}));

vi.mock('../../storage/analyses.js', () => ({
  storeAnalysis: vi.fn(),
  isAlreadyAnalyzed: vi.fn(),
}));

vi.mock('../../storage/suggestions.js', () => ({
  loadSuggestionsIndex: vi.fn(),
  saveSuggestionsIndex: vi.fn(),
}));

import { analyzeSession } from '../../core/analyzer.js';
import { loadConfig, getDataDir } from '../../storage/config.js';
import { storeAnalysis, isAlreadyAnalyzed } from '../../storage/analyses.js';
import { loadSuggestionsIndex, saveSuggestionsIndex } from '../../storage/suggestions.js';

const mockAnalyzeSession = vi.mocked(analyzeSession);
const mockLoadConfig = vi.mocked(loadConfig);
const mockGetDataDir = vi.mocked(getDataDir);
const mockStoreAnalysis = vi.mocked(storeAnalysis);
const mockIsAlreadyAnalyzed = vi.mocked(isAlreadyAnalyzed);
const mockLoadSuggestionsIndex = vi.mocked(loadSuggestionsIndex);
const mockSaveSuggestionsIndex = vi.mocked(saveSuggestionsIndex);

function makeConfig() {
  return {
    version: 1 as const,
    provider: { type: 'anthropic' as const, api_key: 'sk-test' },
    telemetry: { enabled: false, device_id: 'test' },
    analysis: { auto_analyze: true, min_messages: 3 },
  };
}

function makeAnalysis() {
  return {
    schema_version: 1 as const,
    session_id: 'abc-123',
    analyzed_at: new Date().toISOString(),
    provider: 'claude_code' as const,
    model_used: 'claude-sonnet-4-20250514',
    duration_seconds: 120,
    message_count: 10,
    tool_use_count: 5,
    frictions: [],
    suggestions: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        target: 'claude_md' as const,
        scope: 'project' as const,
        rule: 'Always run tests before committing',
        confidence: 'high' as const,
        reasoning: 'Tests failed multiple times',
        friction_types: ['repeated_failure' as const],
        status: 'pending' as const,
      },
    ],
    satisfaction: { positive_signals: 3, negative_signals: 1 },
    summary: 'Productive session with minor friction',
  };
}

/**
 * Runs the worker logic extracted into a testable function.
 * We replicate the worker's main() logic here to test it with mocks,
 * rather than spawning a child process.
 */
async function runWorkerLogic(sessionId: string, transcriptPath: string, cwd: string) {
  if (!sessionId || !transcriptPath) {
    throw new Error('Missing arguments');
  }

  try {
    const config = loadConfig();

    if (isAlreadyAnalyzed(sessionId)) return;

    const analysis = await analyzeSession(transcriptPath, { config, projectPath: cwd });
    if (!analysis) return;

    storeAnalysis(analysis);

    const index = loadSuggestionsIndex();
    for (const suggestion of analysis.suggestions) {
      index.push({
        ...suggestion,
        source_analysis: analysis.session_id,
        ...(analysis.project_path ? { project_path: analysis.project_path } : {}),
      });
    }
    saveSuggestionsIndex(index);
  } catch (err) {
    const errorLog = path.join(getDataDir(), 'error.log');
    const entry = `[${new Date().toISOString()}] ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}\n\n`;
    fs.appendFileSync(errorLog, entry);
  }
}

describe('worker logic', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
    mockGetDataDir.mockReturnValue(tmpDir);
    mockLoadConfig.mockReturnValue(makeConfig());
    mockLoadSuggestionsIndex.mockReturnValue([]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should analyze and store results when config exists and session is new', async () => {
    const analysis = makeAnalysis();
    mockIsAlreadyAnalyzed.mockReturnValue(false);
    mockAnalyzeSession.mockResolvedValue(analysis);

    await runWorkerLogic('abc-123', '/tmp/transcript.jsonl', '/tmp/project');

    expect(mockLoadConfig).toHaveBeenCalledOnce();
    expect(mockIsAlreadyAnalyzed).toHaveBeenCalledWith('abc-123');
    expect(mockAnalyzeSession).toHaveBeenCalledWith('/tmp/transcript.jsonl', {
      config: makeConfig(),
      projectPath: '/tmp/project',
    });
    expect(mockStoreAnalysis).toHaveBeenCalledWith(analysis);
    expect(mockSaveSuggestionsIndex).toHaveBeenCalledWith([
      {
        ...analysis.suggestions[0],
        source_analysis: 'abc-123',
      },
    ]);
  });

  it('should skip if session is already analyzed', async () => {
    mockIsAlreadyAnalyzed.mockReturnValue(true);

    await runWorkerLogic('abc-123', '/tmp/transcript.jsonl', '/tmp/project');

    expect(mockIsAlreadyAnalyzed).toHaveBeenCalledWith('abc-123');
    expect(mockAnalyzeSession).not.toHaveBeenCalled();
    expect(mockStoreAnalysis).not.toHaveBeenCalled();
  });

  it('should skip if session is too short (analyzeSession returns null)', async () => {
    mockIsAlreadyAnalyzed.mockReturnValue(false);
    mockAnalyzeSession.mockResolvedValue(null);

    await runWorkerLogic('abc-123', '/tmp/transcript.jsonl', '/tmp/project');

    expect(mockAnalyzeSession).toHaveBeenCalledOnce();
    expect(mockStoreAnalysis).not.toHaveBeenCalled();
    expect(mockSaveSuggestionsIndex).not.toHaveBeenCalled();
  });

  it('should log errors to error.log without crashing', async () => {
    mockIsAlreadyAnalyzed.mockReturnValue(false);
    mockAnalyzeSession.mockRejectedValue(new Error('LLM API failed'));

    await runWorkerLogic('abc-123', '/tmp/transcript.jsonl', '/tmp/project');

    const errorLogPath = path.join(tmpDir, 'error.log');
    expect(fs.existsSync(errorLogPath)).toBe(true);
    const content = fs.readFileSync(errorLogPath, 'utf-8');
    expect(content).toContain('LLM API failed');
  });

  it('should log non-Error exceptions to error.log', async () => {
    mockIsAlreadyAnalyzed.mockReturnValue(false);
    mockAnalyzeSession.mockRejectedValue('string error');

    await runWorkerLogic('abc-123', '/tmp/transcript.jsonl', '/tmp/project');

    const errorLogPath = path.join(tmpDir, 'error.log');
    expect(fs.existsSync(errorLogPath)).toBe(true);
    const content = fs.readFileSync(errorLogPath, 'utf-8');
    expect(content).toContain('string error');
  });
});
