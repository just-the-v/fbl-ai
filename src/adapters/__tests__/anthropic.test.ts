import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from '../anthropic.js';
import { createAdapter } from '../registry.js';
import type { Config } from '../../storage/config.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class AuthenticationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthenticationError';
    }
  }

  class MockAnthropic {
    messages = { create: mockCreate };
    constructor() {}
  }

  // Attach AuthenticationError as a static property
  (MockAnthropic as unknown as Record<string, unknown>).AuthenticationError = AuthenticationError;

  return { default: MockAnthropic, AuthenticationError };
});

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyze()', () => {
    it('calls the SDK with the correct model and returns structured response', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      const adapter = new AnthropicAdapter('sk-test-key');
      const result = await adapter.analyze('Analyze this session');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: 'Analyze this session' }],
      });

      expect(result.content).toBe('{"result": "ok"}');
      expect(result.input_tokens).toBe(500);
      expect(result.output_tokens).toBe(200);
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('uses a custom model when provided', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const adapter = new AnthropicAdapter('sk-test-key', 'claude-sonnet-4-20250514');
      await adapter.analyze('test prompt');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-20250514' }),
      );
    });

    it('throws clear error on invalid API key (401)', async () => {
      // Import the mocked AuthenticationError
      const sdk = await import('@anthropic-ai/sdk');
      const AuthError = (sdk.default as unknown as Record<string, new (msg: string) => Error>).AuthenticationError;
      mockCreate.mockRejectedValue(new AuthError('Invalid API key'));

      const adapter = new AnthropicAdapter('sk-invalid');
      await expect(adapter.analyze('test')).rejects.toThrow('Invalid Anthropic API key');
    });

    it('throws network error on connection failure', async () => {
      const err = new Error('fetch failed');
      mockCreate.mockRejectedValue(err);

      const adapter = new AnthropicAdapter('sk-test-key');
      await expect(adapter.analyze('test')).rejects.toThrow('Network error: fetch failed');
    });
  });

  describe('estimateCost()', () => {
    it('returns realistic cost for 50000 input tokens', () => {
      const adapter = new AnthropicAdapter('sk-test-key');
      const cost = adapter.estimateCost(50_000);

      expect(cost.provider).toBe('anthropic');
      expect(cost.model).toBe('claude-haiku-4-5-20251001');
      expect(cost.input_tokens).toBe(50_000);
      // 50000 * 0.80/1M = 0.04 input + 2048 * 4.00/1M ~= 0.008 output
      expect(cost.estimated_cost_usd).toBeCloseTo(0.04 + 0.008192, 4);
      expect(cost.estimated_time_seconds).toBe(5);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when API responds', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      const adapter = new AnthropicAdapter('sk-test-key');
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('returns false when API fails', async () => {
      mockCreate.mockRejectedValue(new Error('connection refused'));

      const adapter = new AnthropicAdapter('sk-test-key');
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('name and model', () => {
    it('has name "anthropic"', () => {
      const adapter = new AnthropicAdapter('sk-test');
      expect(adapter.name).toBe('anthropic');
    });

    it('uses default model when none specified', () => {
      const adapter = new AnthropicAdapter('sk-test');
      expect(adapter.model).toBe('claude-haiku-4-5-20251001');
    });
  });
});

describe('createAdapter (registry)', () => {
  const baseConfig: Config = {
    version: 1,
    provider: { type: 'anthropic', api_key: 'sk-test-key' },
    telemetry: { enabled: false, device_id: 'test-device' },
    analysis: { auto_analyze: false, min_messages: 5 },
  };

  it('returns AnthropicAdapter for anthropic provider', () => {
    const adapter = createAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
    expect(adapter.name).toBe('anthropic');
  });

  it('passes custom model from config', () => {
    const config: Config = {
      ...baseConfig,
      provider: { ...baseConfig.provider, model: 'claude-sonnet-4-20250514' },
    };
    const adapter = createAdapter(config);
    expect(adapter.model).toBe('claude-sonnet-4-20250514');
  });

  it('throws when API key is missing', () => {
    const config: Config = {
      ...baseConfig,
      provider: { type: 'anthropic' },
    };
    expect(() => createAdapter(config)).toThrow('Anthropic API key required');
  });

  it('returns OpenRouterAdapter for openrouter provider', () => {
    const config: Config = {
      ...baseConfig,
      provider: { type: 'openrouter', api_key: 'sk-or-test' },
    };
    const adapter = createAdapter(config);
    expect(adapter.name).toBe('openrouter');
  });

  it('returns OllamaAdapter for local provider', () => {
    const config: Config = {
      ...baseConfig,
      provider: { type: 'local', base_url: 'http://localhost:11434' },
    };
    const adapter = createAdapter(config);
    expect(adapter.name).toBe('local');
  });
});
