import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from '../local.js';
import { createAdapter } from '../registry.js';
import type { Config } from '../../storage/config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OllamaAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyze()', () => {
    it('sends the correct payload to /api/chat', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: '{"result": "ok"}' },
          prompt_eval_count: 400,
          eval_count: 100,
        }),
      });

      const adapter = new OllamaAdapter();
      const result = await adapter.analyze('Analyze this session');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.1:8b',
          messages: [{ role: 'user', content: 'Analyze this session' }],
          stream: false,
          format: 'json',
          options: { num_ctx: 32768 },
        }),
      });

      expect(result.content).toBe('{"result": "ok"}');
      expect(result.input_tokens).toBe(400);
      expect(result.output_tokens).toBe(100);
      expect(result.model).toBe('llama3.1:8b');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('throws when Ollama is not running (fetch throws)', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const adapter = new OllamaAdapter();
      await expect(adapter.analyze('test')).rejects.toThrow(
        'Ollama is not running. Start it with: ollama serve',
      );
    });

    it('throws with suggestion when model is not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'model "llama3.1:8b" not found',
      });

      const adapter = new OllamaAdapter();
      await expect(adapter.analyze('test')).rejects.toThrow(
        'Model "llama3.1:8b" not found. Install it with: ollama pull llama3.1:8b',
      );
    });

    it('throws generic error on other HTTP failures', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal server error',
      });

      const adapter = new OllamaAdapter();
      await expect(adapter.analyze('test')).rejects.toThrow(
        'Ollama error: 500 internal server error',
      );
    });

    it('defaults to 0 tokens when counts are missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: '{}' },
        }),
      });

      const adapter = new OllamaAdapter();
      const result = await adapter.analyze('test');
      expect(result.input_tokens).toBe(0);
      expect(result.output_tokens).toBe(0);
    });
  });

  describe('estimateCost()', () => {
    it('returns $0 and ~100s for 50000 tokens', () => {
      const adapter = new OllamaAdapter();
      const cost = adapter.estimateCost(50_000);

      expect(cost.provider).toBe('local');
      expect(cost.model).toBe('llama3.1:8b');
      expect(cost.input_tokens).toBe(50_000);
      expect(cost.estimated_cost_usd).toBe(0);
      expect(cost.estimated_time_seconds).toBe(100);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when /api/tags responds OK', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const adapter = new OllamaAdapter();
      expect(await adapter.isAvailable()).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    });

    it('returns false when /api/tags fails', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const adapter = new OllamaAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });

    it('returns false when /api/tags returns non-OK', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const adapter = new OllamaAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('custom base_url', () => {
    it('uses custom base URL for API calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: '{}' },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      const adapter = new OllamaAdapter('llama3.1:8b', 'http://remote:11434');
      await adapter.analyze('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://remote:11434/api/chat',
        expect.any(Object),
      );
    });

    it('uses custom base URL for isAvailable', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const adapter = new OllamaAdapter('llama3.1:8b', 'http://remote:11434');
      await adapter.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith('http://remote:11434/api/tags');
    });
  });

  describe('name and model', () => {
    it('has name "local"', () => {
      const adapter = new OllamaAdapter();
      expect(adapter.name).toBe('local');
    });

    it('uses default model when none specified', () => {
      const adapter = new OllamaAdapter();
      expect(adapter.model).toBe('llama3.1:8b');
    });

    it('uses custom model when provided', () => {
      const adapter = new OllamaAdapter('mistral:7b');
      expect(adapter.model).toBe('mistral:7b');
    });
  });
});

describe('createAdapter (registry) - local', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig: Config = {
    version: 1,
    provider: { type: 'local' },
    telemetry: { enabled: false, device_id: 'test-device' },
    analysis: { auto_analyze: false, min_messages: 5 },
  };

  it('returns OllamaAdapter for local provider', () => {
    const adapter = createAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.name).toBe('local');
  });

  it('passes custom model and base_url from config', () => {
    const config: Config = {
      ...baseConfig,
      provider: { type: 'local', model: 'mistral:7b', base_url: 'http://remote:11434' },
    };
    const adapter = createAdapter(config);
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.model).toBe('mistral:7b');
  });

  it('uses defaults when model and base_url are not specified', () => {
    const adapter = createAdapter(baseConfig);
    expect(adapter.model).toBe('llama3.1:8b');
  });
});
