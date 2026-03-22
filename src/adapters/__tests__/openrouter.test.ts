import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterAdapter } from '../openrouter.js';
import { createAdapter } from '../registry.js';
import type { Config } from '../../storage/config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OpenRouterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyze()', () => {
    it('sends the correct payload with headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"result": "ok"}' } }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        }),
      });

      const adapter = new OpenRouterAdapter('or-test-key');
      await adapter.analyze('Analyze this session');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer or-test-key',
            'Content-Type': 'application/json',
            'X-Title': 'fbl',
          },
          body: JSON.stringify({
            model: 'meta-llama/llama-3.1-8b-instruct',
            max_tokens: 2048,
            messages: [{ role: 'user', content: 'Analyze this session' }],
            response_format: { type: 'json_object' },
          }),
        }),
      );
    });

    it('extracts content and tokens correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score": 8}' } }],
          usage: { prompt_tokens: 300, completion_tokens: 150 },
        }),
      });

      const adapter = new OpenRouterAdapter('or-test-key');
      const result = await adapter.analyze('test prompt');

      expect(result.content).toBe('{"score": 8}');
      expect(result.input_tokens).toBe(300);
      expect(result.output_tokens).toBe(150);
      expect(result.model).toBe('meta-llama/llama-3.1-8b-instruct');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('throws "Invalid OpenRouter API key" on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const adapter = new OpenRouterAdapter('or-invalid');
      await expect(adapter.analyze('test')).rejects.toThrow('Invalid OpenRouter API key');
    });

    it('throws "Model not found" on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const adapter = new OpenRouterAdapter('or-test-key', 'unknown/model');
      await expect(adapter.analyze('test')).rejects.toThrow('Model not found: unknown/model');
    });
  });

  describe('estimateCost()', () => {
    it('calculates correctly for default model', () => {
      const adapter = new OpenRouterAdapter('or-test-key');
      const cost = adapter.estimateCost(50_000);

      expect(cost.provider).toBe('openrouter');
      expect(cost.model).toBe('meta-llama/llama-3.1-8b-instruct');
      expect(cost.input_tokens).toBe(50_000);
      // 50000 * 0.06/1M = 0.003 input + 2048 * 0.06/1M = 0.00012288 output
      expect(cost.estimated_cost_usd).toBeCloseTo(0.003 + 0.00012288, 6);
      expect(cost.estimated_time_seconds).toBe(8);
    });

    it('uses fallback pricing for unknown model', () => {
      const adapter = new OpenRouterAdapter('or-test-key', 'custom/model');
      const cost = adapter.estimateCost(100_000);

      // 100000 * 0.10/1M = 0.01 input + 2048 * 0.10/1M = 0.0002048 output
      expect(cost.estimated_cost_usd).toBeCloseTo(0.01 + 0.0002048, 6);
    });
  });

  describe('isAvailable()', () => {
    it('uses /api/v1/models endpoint and returns true when ok', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const adapter = new OpenRouterAdapter('or-test-key');
      expect(await adapter.isAvailable()).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        { headers: { 'Authorization': 'Bearer or-test-key' } },
      );
    });

    it('returns false when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      const adapter = new OpenRouterAdapter('or-test-key');
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('name and model', () => {
    it('has name "openrouter"', () => {
      const adapter = new OpenRouterAdapter('or-test');
      expect(adapter.name).toBe('openrouter');
    });

    it('uses default model when none specified', () => {
      const adapter = new OpenRouterAdapter('or-test');
      expect(adapter.model).toBe('meta-llama/llama-3.1-8b-instruct');
    });
  });
});

describe('createAdapter with openrouter', () => {
  const baseConfig: Config = {
    version: 1,
    provider: { type: 'openrouter', api_key: 'or-test' },
    telemetry: { enabled: false, device_id: 'test-device' },
    analysis: { auto_analyze: false, min_messages: 5 },
  };

  it('returns OpenRouterAdapter for openrouter provider', () => {
    const adapter = createAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(OpenRouterAdapter);
    expect(adapter.name).toBe('openrouter');
  });

  it('throws when API key is missing', () => {
    const config: Config = {
      ...baseConfig,
      provider: { type: 'openrouter' },
    };
    expect(() => createAdapter(config)).toThrow('OpenRouter API key required');
  });
});
