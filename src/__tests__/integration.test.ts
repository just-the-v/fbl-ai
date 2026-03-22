import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { analyzeSession } from '../core/analyzer.js';
import { loadConfig, type Config } from '../storage/config.js';
import { storeAnalysis, listAnalyses, isAlreadyAnalyzed } from '../storage/analyses.js';
import {
  saveSuggestionsIndex,
  getSuggestionsByStatus,
  updateSuggestionStatus,
  type SuggestionIndexItem,
} from '../storage/suggestions.js';
import { anonymizeAnalysis, TelemetryPayloadSchema } from '../telemetry/anonymize.js';
import { createAdapter } from '../adapters/registry.js';
import type { SessionAnalysis } from '../core/schema.js';
import type { LLMAdapter, LLMResponse, CostEstimate } from '../adapters/types.js';

// --- Mock LLM adapter ---

const MOCK_LLM_RESPONSE = {
  frictions: [
    {
      type: 'wrong_approach',
      category: 'testing',
      severity: 'medium',
      description: 'Used wrong testing framework',
      count: 2,
    },
  ],
  suggestions: [
    {
      target: 'claude_md',
      scope: 'project',
      rule: 'Always use vitest for testing in this project',
      confidence: 'high' as const,
      reasoning: 'Multiple test framework confusion detected',
    },
  ],
  satisfaction: { positive_signals: 3, negative_signals: 1 },
  summary: 'Session had testing framework issues',
};

function createMockAdapter(): LLMAdapter {
  return {
    name: 'mock',
    model: 'mock-model-v1',
    async analyze(_prompt: string): Promise<LLMResponse> {
      return {
        content: JSON.stringify(MOCK_LLM_RESPONSE),
        input_tokens: 100,
        output_tokens: 200,
        model: 'mock-model-v1',
        latency_ms: 10,
      };
    },
    estimateCost(inputTokens: number): CostEstimate {
      return {
        provider: 'mock',
        model: 'mock-model-v1',
        input_tokens: inputTokens,
        estimated_cost_usd: 0,
        estimated_time_seconds: 0,
      };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

// --- Helpers ---

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1 as const,
    provider: {
      type: 'anthropic',
      api_key: 'test-key-123',
      model: 'claude-haiku-4-5-20251001',
    },
    telemetry: {
      enabled: true,
      device_id: 'test-device-001',
    },
    analysis: {
      auto_analyze: true,
      min_messages: 3,
    },
    ...overrides,
  };
}

function makeSessionAnalysis(overrides: Partial<SessionAnalysis> = {}): SessionAnalysis {
  const id1 = randomUUID();
  const id2 = randomUUID();
  return {
    schema_version: 1 as const,
    session_id: randomUUID(),
    analyzed_at: new Date().toISOString(),
    provider: 'claude_code' as const,
    model_used: 'mock-model-v1',
    duration_seconds: 120,
    message_count: 10,
    tool_use_count: 3,
    frictions: [
      {
        type: 'wrong_approach',
        category: 'testing',
        severity: 'medium',
        description: 'Used wrong testing framework',
        count: 2,
      },
    ],
    suggestions: [
      {
        id: id1,
        target: 'claude_md',
        scope: 'project',
        rule: 'Always use vitest for testing in this project',
        confidence: 'high' as const,
        reasoning: 'Multiple test framework confusion detected',
        status: 'pending',
      },
      {
        id: id2,
        target: 'skill',
        scope: 'global',
        rule: 'Use skill for repetitive test patterns',
        confidence: 'medium' as const,
        reasoning: 'Repeated similar test setups across sessions',
        status: 'pending',
      },
    ],
    satisfaction: { positive_signals: 3, negative_signals: 1 },
    summary: 'Session had testing framework issues',
    ...overrides,
  };
}

// --- Test suite ---

describe('Integration tests', () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'feedbackoops-test-'));
    originalDataDir = process.env.FBL_DATA_DIR;
    originalConfigPath = process.env.FBL_CONFIG;
    process.env.FBL_DATA_DIR = tmpDir;
    // Ensure config path also points to tmpDir
    delete process.env.FBL_CONFIG;
  });

  afterEach(() => {
    if (originalDataDir !== undefined) {
      process.env.FBL_DATA_DIR = originalDataDir;
    } else {
      delete process.env.FBL_DATA_DIR;
    }
    if (originalConfigPath !== undefined) {
      process.env.FBL_CONFIG = originalConfigPath;
    } else {
      delete process.env.FBL_CONFIG;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------
  // Test 1: Flow analyze -> store -> read
  // -------------------------------------------------------
  it('should analyze a session, store it, and read it back', async () => {
    // 1. Create config.json in tmpDir
    const config = makeConfig();
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config, null, 2));

    // 2. Analyze session with mock adapter
    const fixturePath = join(
      __dirname,
      '..',
      'core',
      '__tests__',
      'fixtures',
      'short-session.jsonl',
    );
    const result = await analyzeSession(fixturePath, {
      config,
      adapter: createMockAdapter(),
    });

    // 3. Verify result is a valid SessionAnalysis
    expect(result).not.toBeNull();
    const analysis = result!;
    expect(analysis.schema_version).toBe(1);
    expect(analysis.session_id).toBe('session-001');
    expect(analysis.provider).toBe('claude_code');
    expect(analysis.model_used).toBe('mock-model-v1');
    expect(analysis.frictions.length).toBeGreaterThan(0);
    expect(analysis.suggestions.length).toBeGreaterThan(0);
    // Each suggestion should have a UUID id and status 'pending'
    for (const s of analysis.suggestions) {
      expect(s.id).toBeDefined();
      expect(s.status).toBe('pending');
    }

    // 4. Store the analysis
    storeAnalysis(analysis);

    // 5. Verify file exists in analyses/
    const analysesDir = join(tmpDir, 'analyses');
    expect(existsSync(analysesDir)).toBe(true);
    const files = readdirSync(analysesDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(1);

    // 6. List analyses and verify it's found
    const listed = listAnalyses();
    expect(listed.length).toBe(1);
    expect(listed[0].session_id).toBe('session-001');

    // 7. isAlreadyAnalyzed should return true
    expect(isAlreadyAnalyzed('session-001')).toBe(true);
    expect(isAlreadyAnalyzed('nonexistent-session')).toBe(false);
  });

  // -------------------------------------------------------
  // Test 2: Flow suggestions tracking
  // -------------------------------------------------------
  it('should track suggestion status changes', () => {
    const analysis = makeSessionAnalysis();
    const suggestion1 = analysis.suggestions[0];
    const suggestion2 = analysis.suggestions[1];

    // 1. Store suggestions index
    const indexItems: SuggestionIndexItem[] = analysis.suggestions.map((s) => ({
      ...s,
      source_analysis: analysis.session_id,
    }));
    saveSuggestionsIndex(indexItems);

    // 2. Verify pending count
    const pending1 = getSuggestionsByStatus('pending');
    expect(pending1.length).toBe(2);

    // 3. Update one suggestion to 'applied'
    updateSuggestionStatus(suggestion1.id, 'applied', new Date().toISOString());

    // 4. Verify counts
    const pending2 = getSuggestionsByStatus('pending');
    expect(pending2.length).toBe(1);
    expect(pending2[0].id).toBe(suggestion2.id);

    const applied = getSuggestionsByStatus('applied');
    expect(applied.length).toBe(1);
    expect(applied[0].id).toBe(suggestion1.id);
  });

  // -------------------------------------------------------
  // Test 3: Flow telemetry anonymization
  // -------------------------------------------------------
  it('should anonymize analysis and produce a valid TelemetryPayload', () => {
    const config = makeConfig();
    const analysis = makeSessionAnalysis({
      summary: 'This session had some sensitive details about the project',
    });

    // Make sure the analysis has description, rule, reasoning, summary
    expect(analysis.frictions[0].description).toBeDefined();
    expect(analysis.suggestions[0].rule).toBeDefined();
    expect(analysis.suggestions[0].reasoning).toBeDefined();
    expect(analysis.summary).toBeDefined();

    // Anonymize
    const payload = anonymizeAnalysis(analysis, config);

    // Verify sensitive fields are NOT in the payload
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain(analysis.frictions[0].description);
    expect(payloadStr).not.toContain(analysis.suggestions[0].rule);
    expect(payloadStr).not.toContain(analysis.suggestions[0].reasoning);
    expect(payloadStr).not.toContain(analysis.summary);

    // Verify the payload does NOT have these keys
    const analysisPayload = payload.analysis as Record<string, unknown>;
    expect(analysisPayload).not.toHaveProperty('summary');
    for (const f of payload.analysis.frictions) {
      expect(f).not.toHaveProperty('description');
    }
    for (const s of payload.analysis.suggestions) {
      expect(s).not.toHaveProperty('rule');
      expect(s).not.toHaveProperty('reasoning');
    }

    // Verify it passes schema validation
    const parsed = TelemetryPayloadSchema.parse(payload);
    expect(parsed.device_id).toBe('test-device-001');
    expect(parsed.analysis.provider).toBe('claude_code');
    expect(parsed.analysis.frictions.length).toBe(1);
    expect(parsed.analysis.suggestions.length).toBe(2);
  });

  // -------------------------------------------------------
  // Test 4: Edge case - session too short
  // -------------------------------------------------------
  it('should return null for sessions shorter than min_messages', async () => {
    const config = makeConfig({
      analysis: { auto_analyze: true, min_messages: 100 },
    });

    const fixturePath = join(
      __dirname,
      '..',
      'core',
      '__tests__',
      'fixtures',
      'short-session.jsonl',
    );

    const result = await analyzeSession(fixturePath, {
      config,
      adapter: createMockAdapter(),
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------
  // Test 5: Edge case - config absent
  // -------------------------------------------------------
  it('should throw when config.json is missing', () => {
    // Do NOT create config.json - tmpDir is empty
    expect(() => loadConfig()).toThrow();
  });

  // -------------------------------------------------------
  // Test 6: Adapter registry
  // -------------------------------------------------------
  it('should create an adapter from config', () => {
    const config = makeConfig({
      provider: {
        type: 'anthropic',
        api_key: 'test-key-123',
      },
    });

    const adapter = createAdapter(config);
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('anthropic');
    expect(adapter.model).toBeDefined();
  });
});
